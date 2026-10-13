using FluentValidation;
using Microsoft.EntityFrameworkCore;
using VayuVata.Authorization;
using VayuVata.Data;
using VayuVata.DTOs.Users;
using VayuVata.Helpers;
using VayuVata.Models;

namespace VayuVata.Services;

/// <summary>
/// Account management and the manager hierarchy.
/// SuperAdmin / Admin accounts: ManagerId = NULL.
/// Regular User: ManagerId = an active Admin (Admin-managed) or the SuperAdmin (standalone).
/// </summary>
public class UserService(
    VayuVataDbContext db,
    IValidator<CreateUserRequest> createValidator,
    IValidator<CreateManagedUserRequest> managedValidator,
    IValidator<UpdateUserRequest> updateValidator,
    IValidator<ManagerAssignmentRequest> assignmentValidator,
    IValidator<ResetPasswordRequest> resetValidator,
    ILogger<UserService> log)
{
    private static IQueryable<UserDto> Project(IQueryable<User> q) => q.Select(u => new UserDto
    {
        Id = u.Id, Name = u.Name, Email = u.Email, Role = u.Role, ManagerId = u.ManagerId,
        ManagerName = u.Manager != null ? u.Manager.Name : null,
        ManagerRole = u.Manager != null ? u.Manager.Role : null,
        AssignmentType = u.Manager == null ? null : (u.Manager.Role == Roles.SuperAdmin ? "Standalone" : "AdminManaged"),
        IsActive = u.IsActive, CreatedAt = u.CreatedAt, UpdatedAt = u.UpdatedAt, LastLoginAt = u.LastLoginAt,
    });

    // ------------------------------------------------------------------ create

    /// <summary>Single creation path used by POST /users and POST /admins/{adminId}/users. Role and manager are decided here, never by the client.</summary>
    public async Task<UserDto> CreateAsync(CreateUserRequest req, CurrentUser caller, CancellationToken ct)
    {
        if (caller.IsUser) throw ApiException.Forbidden();
        await createValidator.ValidateAndThrowAsync(req, ct);

        int? managerId;
        if (caller.IsAdmin)
        {
            if (req.Role != Roles.User) throw ApiException.Forbidden("Admins can only create regular Users.");
            if (req.ManagerId != null && req.ManagerId != caller.Id)
                throw ApiException.Forbidden("Admins cannot create Users under another account.");
            managerId = caller.Id;
        }
        else if (req.Role == Roles.Admin)
        {
            if (req.ManagerId != null) throw ApiException.BadRequest("An Admin account has no manager.");
            managerId = null;
        }
        else
        {
            // Standalone by default: the SuperAdmin manages the User directly.
            managerId = req.ManagerId is { } m ? (await ResolveManagerAsync(m, caller, ct)).Id : caller.Id;
        }

        var email = req.Email.Trim().ToLowerInvariant();
        if (await db.Users.AnyAsync(u => u.Email == email, ct))
            throw ApiException.Conflict("A user with this email already exists.", "email_taken");

        var user = new User
        {
            Name = req.Name.Trim(), Email = email, Role = req.Role, ManagerId = managerId,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password),
        };
        db.Users.Add(user);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (SqlErrors.IsUniqueViolation(ex))
        {
            throw ApiException.Conflict("A user with this email already exists.", "email_taken");
        }
        log.LogInformation("User {Id} ({Role}) created with manager {ManagerId} by {CallerId}", user.Id, user.Role, user.ManagerId, caller.Id);
        return await GetAsync(user.Id, caller, ct);
    }

    /// <summary>POST /admins/{adminId}/users: a User directly under the given Admin, via the same creation path.</summary>
    public async Task<UserDto> CreateUnderAdminAsync(int adminId, CreateManagedUserRequest req, CurrentUser caller, CancellationToken ct)
    {
        if (caller.IsUser) throw ApiException.Forbidden();
        if (caller.IsAdmin && caller.Id != adminId) throw ApiException.Forbidden("You can only create Users under yourself.");
        await managedValidator.ValidateAndThrowAsync(req, ct);
        await GetAdminAsync(adminId, ct);
        return await CreateAsync(new CreateUserRequest
        {
            Name = req.Name, Email = req.Email, Password = req.Password, Role = Roles.User, ManagerId = adminId,
        }, caller, ct);
    }

    // ------------------------------------------------------------------ read

    public Task<PagedResult<UserDto>> ListAsync(UserQuery q, CurrentUser caller, CancellationToken ct)
    {
        if (caller.IsUser) throw ApiException.Forbidden();
        if (caller.IsAdmin)
        {
            // Scope can only be narrowed, never widened, by query parameters.
            if (q.ManagerId != null && q.ManagerId != caller.Id) throw ApiException.Forbidden("Filtering by another manager is restricted to SuperAdmin.");
            if (q.Standalone != null) throw ApiException.Forbidden("The standalone filter is restricted to SuperAdmin.");
        }
        var query = db.VisibleUsers(caller).AsNoTracking();
        if (!string.IsNullOrWhiteSpace(q.Role)) query = query.Where(u => u.Role == q.Role);
        if (q.ManagerId != null) query = query.Where(u => u.ManagerId == q.ManagerId);
        if (q.Standalone == true) query = query.Where(u => u.Role == Roles.User && u.Manager!.Role == Roles.SuperAdmin);
        if (q.Standalone == false) query = query.Where(u => u.Role == Roles.User && u.Manager!.Role == Roles.Admin);
        if (q.IsActive != null) query = query.Where(u => u.IsActive == q.IsActive);
        query = Search(query, q.Search);
        return Project(query.OrderBy(u => u.Id)).ToPagedAsync(q, ct);
    }

    /// <summary>GET /admins/{adminId}/users: exactly the regular Users managed by that Admin.</summary>
    public async Task<AdminUsersPage> ListByAdminAsync(int adminId, ManagedUsersQuery q, CurrentUser caller, CancellationToken ct)
    {
        if (caller.IsUser) throw ApiException.Forbidden();
        if (caller.IsAdmin && caller.Id != adminId) throw ApiException.Forbidden("You can only list your own Users.");
        var admin = await GetAdminAsync(adminId, ct);

        var query = db.Users.AsNoTracking().Where(u => u.ManagerId == adminId && u.Role == Roles.User);
        if (q.IsActive != null) query = query.Where(u => u.IsActive == q.IsActive);
        query = Search(query, q.Search);
        var page = await Project(query.OrderBy(u => u.Id)).ToPagedAsync(q, ct);
        return new AdminUsersPage
        {
            AdminId = admin.Id, AdminName = admin.Name,
            Items = page.Items, Page = page.Page, PageSize = page.PageSize, TotalCount = page.TotalCount,
        };
    }

    /// <summary>GET /superadmin/users: regular Users whose manager is the authenticated SuperAdmin (standalone Users).</summary>
    public Task<PagedResult<UserDto>> ListStandaloneAsync(ManagedUsersQuery q, CurrentUser caller, CancellationToken ct)
    {
        if (!caller.IsSuperAdmin) throw ApiException.Forbidden();
        var query = db.Users.AsNoTracking().Where(u => u.ManagerId == caller.Id && u.Role == Roles.User);
        if (q.IsActive != null) query = query.Where(u => u.IsActive == q.IsActive);
        query = Search(query, q.Search);
        return Project(query.OrderBy(u => u.Id)).ToPagedAsync(q, ct);
    }

    public async Task<UserDto> GetAsync(int id, CurrentUser caller, CancellationToken ct) =>
        await Project(db.VisibleUsers(caller).AsNoTracking().Where(u => u.Id == id)).FirstOrDefaultAsync(ct)
        ?? throw ApiException.NotFound("User not found.");

    // ------------------------------------------------------------------ update

    /// <summary>Name and email only. Role and manager can never change here.</summary>
    public async Task<UserDto> UpdateAsync(int id, UpdateUserRequest req, CurrentUser caller, CancellationToken ct)
    {
        var user = await ManageableAsync(id, caller, ct);
        await updateValidator.ValidateAndThrowAsync(req, ct);
        var email = req.Email.Trim().ToLowerInvariant();
        if (await db.Users.AnyAsync(u => u.Email == email && u.Id != id, ct))
            throw ApiException.Conflict("A user with this email already exists.", "email_taken");
        user.Name = req.Name.Trim();
        user.Email = email;
        user.UpdatedAt = DateTime.UtcNow;
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (SqlErrors.IsUniqueViolation(ex))
        {
            throw ApiException.Conflict("A user with this email already exists.", "email_taken");
        }
        return await GetAsync(id, caller, ct);
    }

    public async Task<UserDto> SetStatusAsync(int id, SetStatusRequest req, CurrentUser caller, CancellationToken ct)
    {
        var user = await ManageableAsync(id, caller, ct);
        if (!req.IsActive && user.Role == Roles.SuperAdmin && user.IsActive)
        {
            var otherActive = await db.Users.CountAsync(u => u.Role == Roles.SuperAdmin && u.IsActive && u.Id != id, ct);
            if (otherActive == 0)
                throw ApiException.Conflict("The last active SuperAdmin cannot be deactivated.", "last_superadmin");
        }
        if (id == caller.Id && !req.IsActive)
            throw ApiException.BadRequest("You cannot deactivate your own account.");

        user.IsActive = req.IsActive;
        user.UpdatedAt = DateTime.UtcNow;
        if (req.IsActive) { user.FailedLoginCount = 0; user.LastFailedLoginAt = null; user.LockoutUntil = null; }
        if (!req.IsActive) await RevokeRefreshTokensAsync(id, ct);
        await db.SaveChangesAsync(ct);
        log.LogInformation("User {Id} active={Active} set by {CallerId}", id, req.IsActive, caller.Id);
        return await GetAsync(id, caller, ct);
    }

    /// <summary>
    /// SuperAdmin only. Moves a regular User to an active Admin, or to the SuperAdmin (standalone). Devices, device assignments and
    /// sensor history are untouched; only who may see them changes with the manager relationship.
    /// </summary>
    public async Task<UserDto> SetManagerAsync(int id, ManagerAssignmentRequest req, CurrentUser caller, CancellationToken ct)
    {
        if (!caller.IsSuperAdmin) throw ApiException.Forbidden("Only a SuperAdmin can change a User's manager.");
        await assignmentValidator.ValidateAndThrowAsync(req, ct);

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct) ?? throw ApiException.NotFound("User not found.");
        if (user.Role != Roles.User)
            throw ApiException.BadRequest("Only regular Users can be assigned to a manager; Admin and SuperAdmin accounts have none.");
        var manager = await ResolveManagerAsync(req.ManagerId!.Value, caller, ct);

        if (user.ManagerId != manager.Id)
        {
            var old = user.ManagerId;
            user.ManagerId = manager.Id;
            user.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            log.LogInformation("AUDIT manager change: user {UserId} {OldManagerId} -> {NewManagerId} ({ManagerRole}) by SuperAdmin {CallerId}",
                user.Id, old, manager.Id, manager.Role, caller.Id);
        }
        await tx.CommitAsync(ct);
        return await GetAsync(id, caller, ct);
    }

    public async Task ResetPasswordAsync(int id, ResetPasswordRequest req, CurrentUser caller, CancellationToken ct)
    {
        var user = await ManageableAsync(id, caller, ct);
        await resetValidator.ValidateAndThrowAsync(req, ct);
        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.NewPassword);
        user.UpdatedAt = DateTime.UtcNow;
        // A reset is also the recovery path for a locked-out account.
        user.FailedLoginCount = 0; user.LastFailedLoginAt = null; user.LockoutUntil = null;
        await RevokeRefreshTokensAsync(id, ct);
        await db.SaveChangesAsync(ct);
        log.LogInformation("Password of user {Id} reset by {CallerId}", id, caller.Id);
    }

    // ------------------------------------------------------------------ helpers

    private static IQueryable<User> Search(IQueryable<User> query, string? search)
    {
        if (string.IsNullOrWhiteSpace(search)) return query;
        var s = search.Trim();
        return query.Where(u => u.Name.Contains(s) || u.Email.Contains(s));
    }

    /// <summary>Loads a user the caller is allowed to modify; 403 for plain Users, 404 when out of scope.</summary>
    private async Task<User> ManageableAsync(int id, CurrentUser caller, CancellationToken ct)
    {
        if (caller.IsUser) throw ApiException.Forbidden();
        var visibleIds = db.VisibleUsers(caller).Select(u => u.Id);
        return await db.Users.Where(u => u.Id == id && visibleIds.Contains(u.Id)).FirstOrDefaultAsync(ct)
               ?? throw ApiException.NotFound("User not found.");
    }

    private async Task<User> GetAdminAsync(int adminId, CancellationToken ct) =>
        await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == adminId && u.Role == Roles.Admin, ct)
        ?? throw ApiException.NotFound("Admin not found.");

    /// <summary>A valid manager is an active Admin, or the authenticated (active) SuperAdmin themself.</summary>
    private async Task<User> ResolveManagerAsync(int managerId, CurrentUser caller, CancellationToken ct)
    {
        var m = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == managerId, ct)
                ?? throw ApiException.BadRequest("ManagerId does not refer to an existing account.", "invalid_manager");
        if (m.Role == Roles.Admin)
            return m.IsActive ? m : throw ApiException.BadRequest("The target Admin is inactive.", "invalid_manager");
        if (m.Role == Roles.SuperAdmin && caller.IsSuperAdmin && m.Id == caller.Id && m.IsActive) return m;
        throw ApiException.BadRequest("ManagerId must be an active Admin, or the SuperAdmin's own id for a standalone User.", "invalid_manager");
    }

    private async Task RevokeRefreshTokensAsync(int userId, CancellationToken ct)
    {
        var tokens = await db.RefreshTokens.Where(t => t.UserId == userId && t.RevokedAt == null).ToListAsync(ct);
        foreach (var t in tokens) t.RevokedAt = DateTime.UtcNow;
    }
}
