using System.Security.Cryptography;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using VayuVata.Authorization;
using VayuVata.Data;
using VayuVata.DTOs.Registration;
using VayuVata.Helpers;
using VayuVata.Models;
using VayuVata.Validators;
using static VayuVata.Services.EmailTemplates;

namespace VayuVata.Services;

public class RegistrationOptions
{
    /// <summary>Address the panel is reached at, e.g. https://72.61.170.214:5081 . Used to build the registration and activation links in emails.</summary>
    public string PublicBaseUrl { get; set; } = "";
    /// <summary>How long an activation link works.</summary>
    public int InvitationHours { get; set; } = 72;
    /// <summary>When set, Super Admin notification emails go to these addresses instead of the Super Admin accounts' own emails.</summary>
    public string[] SuperAdminNotifyEmails { get; set; } = [];
}

/// <summary>
/// Common public registration (Admin / User), Super Admin approval, direct account creation with an activation invitation, and the notification emails.
/// A public registration is only a request until approved; the account (dbo.Users row, inactive) is created at approval / direct creation and becomes active
/// only when its owner sets a password through the single-use activation link.
/// </summary>
public class RegistrationService(
    VayuVataDbContext db, NotificationService notifier, IOptions<RegistrationOptions> options,
    IValidator<RegisterRequest> registerValidator, IValidator<InviteUserRequest> inviteValidator, IValidator<ActivateRequest> activateValidator,
    IValidator<SendRegistrationLinkRequest> linkValidator, ILogger<RegistrationService> log)
{
    private readonly RegistrationOptions _o = options.Value;

    private static string Norm(string? e) => (e ?? "").Trim().ToLowerInvariant();

    // ------------------------------------------------------------------ links and tokens

    private string Base() => _o.PublicBaseUrl.Trim().TrimEnd('/');
    private string RequireBase() => Base().Length > 0 ? Base() : throw ApiException.Conflict("The panel address for email links is not configured (Registration:PublicBaseUrl).", "link_base_missing");
    public string RegisterLink() => RequireBase() + "/register";
    private string ActivationLink(string token) => RequireBase() + "/activate?token=" + Uri.EscapeDataString(token);

    private static string NewToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).Replace('+', '-').Replace('/', '_').TrimEnd('=');

    /// <summary>Replaces any open invitation of the user with a new single-use, expiring one. Returns the raw token (it exists only in the email).</summary>
    private async Task<(string Token, DateTime Expires)> NewInvitationAsync(User user, int? creatorId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        await db.AccountInvitations.Where(i => i.UserId == user.Id && i.UsedAt == null && i.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.RevokedAt, now), ct);
        var token = NewToken();
        var expires = now.AddHours(Math.Max(1, _o.InvitationHours));
        db.AccountInvitations.Add(new AccountInvitation { UserId = user.Id, TokenHash = JwtService.Hash(token), ExpiresAt = expires, CreatedByUserId = creatorId });
        await db.SaveChangesAsync(ct);
        return (token, expires);
    }

    private void History(string action, int? actor, int? requestId, int? target, string? detail) =>
        db.AccountHistory.Add(new AccountHistory { Action = action, ActorUserId = actor, RequestId = requestId, TargetUserId = target, Detail = detail is { Length: > 500 } ? detail[..500] : detail });

    // ------------------------------------------------------------------ emails

    private Task<EmailOutcomeDto> SendAsync(string template, EmailMessage msg, int? requestId, int? userId, CancellationToken ct) => notifier.SendAsync(template, msg, requestId, userId, ct);

    private Task<List<EmailOutcomeDto>> ToSuperAdminsAsync(string template, string subject, string heading, string[] paragraphs, int? requestId, int? userId, CancellationToken ct) =>
        notifier.ToSuperAdminsAsync(template, subject, heading, paragraphs, requestId, userId, ct);

    private static string RoleWord(string role) => role == Roles.Admin ? "Admin" : "User";

    // ------------------------------------------------------------------ public registration

    public async Task<RegisterResponse> RegisterAsync(RegisterRequest req, CancellationToken ct)
    {
        await registerValidator.ValidateAndThrowAsync(req, ct);
        var emailAddr = Norm(req.Email);
        var mobile = ContactRules.CleanMobile(req.Mobile);
        var name = req.FullName.Trim();

        User? admin = null;
        if (req.RequestedRole == Roles.User)
        {
            var adminEmail = Norm(req.AdminEmail);
            admin = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Email == adminEmail && u.Role == Roles.Admin && u.IsActive, ct)
                    ?? throw ApiException.BadRequest("No approved Admin account was found for that email address. Check the address with your Admin.", "admin_not_found");
        }
        if (await db.Users.AnyAsync(u => u.Email == emailAddr, ct)) throw ApiException.Conflict("An account with this email already exists.", "email_taken");
        if (await db.RegistrationRequests.AnyAsync(r => r.Email == emailAddr && r.Status == RegistrationStatus.Pending, ct))
            throw ApiException.Conflict("A registration for this email is already waiting for approval.", "registration_pending");

        var request = new RegistrationRequest
        {
            FullName = name, Email = emailAddr, Mobile = mobile, RequestedRole = req.RequestedRole, DeviceCode = string.IsNullOrWhiteSpace(req.DeviceId) ? null : req.DeviceId.Trim(),
            AdminEmail = admin is null ? null : admin.Email, AdminUserId = admin?.Id,
        };
        db.RegistrationRequests.Add(request);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (SqlErrors.IsUniqueViolation(ex)) { throw ApiException.Conflict("A registration for this email is already waiting for approval.", "registration_pending"); }
        History("Registered", null, request.Id, null, $"{req.RequestedRole} registration from {LogRedactor.MaskEmail(emailAddr)}");
        await db.SaveChangesAsync(ct);
        log.LogInformation("Registration request {Id} ({Role}) received", request.Id, request.RequestedRole);

        var role = RoleWord(request.RequestedRole);
        // applicant: confirmation
        await SendAsync("RegistrationConfirmation", Build(emailAddr, "We received your registration", "Registration received",
            new[] { $"Hello {H(name)},", $"Thank you for registering as <b>{role}</b> on LIVVAir Protect. Your request is <b>waiting for approval</b> by the Super Admin." }
              .Concat(request.DeviceCode is null ? Array.Empty<string>() : new[] { $"Device ID you entered: <b>{H(request.DeviceCode)}</b>. It will be assigned to you when your request is approved." })
              .Append("You will receive another email with a link to set your password once your account is approved. Until then you cannot sign in.").ToArray()), request.Id, null, ct);
        // associated Admin: registration notification
        if (admin is not null)
            await SendAsync("AdminUserRegistered", Build(admin.Email, $"New user registered under your account: {name}", "A user registered under your account",
                [$"Hello {H(admin.Name)},", $"<b>{H(name)}</b> ({H(emailAddr)}, {H(mobile)}) registered as a User and named you as their Admin.", "The registration is waiting for Super Admin approval. You will be told when it is approved."]), request.Id, admin.Id, ct);
        // Super Admin: registration notification
        await ToSuperAdminsAsync("SuperAdminRegistration", $"New {role} registration: {name}", "New registration waiting for approval",
            [$"<b>{H(name)}</b> ({H(emailAddr)}, {H(mobile)}) asked for a <b>{role}</b> account." + (admin is null ? "" : $" Admin entered: {H(admin.Name)} ({H(admin.Email)}).") + (request.DeviceCode is null ? "" : $" Device ID entered: <b>{H(request.DeviceCode)}</b>."), "Open User Management, Registration Requests to approve or reject it. If the device is not registered yet, create it first; approval then assigns it automatically."], request.Id, null, ct);

        return new RegisterResponse { RequestId = request.Id, Status = RegistrationStatus.Pending, Message = "Thank you. Your registration is waiting for approval. We sent a confirmation to your email." };
    }

    // ------------------------------------------------------------------ Super Admin: requests

    private static string ActivationStatusOf(bool isActive, DateTime? emailConfirmedAt) => isActive ? "Active" : emailConfirmedAt == null ? "Pending activation" : "Inactive";

    public async Task<PagedResult<RegistrationRequestDto>> ListAsync(RegistrationQuery q, CancellationToken ct)
    {
        var query = db.RegistrationRequests.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(q.Status))
        {
            if (q.Status is not (RegistrationStatus.Pending or RegistrationStatus.Approved or RegistrationStatus.Rejected)) throw ApiException.BadRequest("status must be Pending, Approved or Rejected.");
            query = query.Where(r => r.Status == q.Status);
        }
        if (!string.IsNullOrWhiteSpace(q.Search)) { var s = q.Search.Trim(); query = query.Where(r => r.FullName.Contains(s) || r.Email.Contains(s) || r.Mobile.Contains(s)); }
        var page = await query.OrderByDescending(r => r.CreatedAt).ThenByDescending(r => r.Id).Select(r => new RegistrationRequestDto
        {
            Id = r.Id, FullName = r.FullName, Email = r.Email, Mobile = r.Mobile, RequestedRole = r.RequestedRole, AdminEmail = r.AdminEmail, AdminUserId = r.AdminUserId, DeviceId = r.DeviceCode,
            AdminName = r.AdminUser != null ? r.AdminUser.Name : null, Status = r.Status, CreatedAt = r.CreatedAt, DecidedAt = r.DecidedAt,
            DecidedByName = r.DecidedBy != null ? r.DecidedBy.Name : null, DecisionNote = r.DecisionNote, ApprovedRole = r.ApprovedRole, UserId = r.UserId,
            ActivationStatus = r.User == null ? null : r.User.IsActive ? "Active" : r.User.EmailConfirmedAt == null ? "Pending activation" : "Inactive",
        }).ToPagedAsync(q, ct);
        await EnrichDevicesAsync(page.Items, ct);
        return page;
    }

    private async Task<RegistrationRequestDto> GetRequestAsync(int id, CancellationToken ct)
    {
        var dto = await db.RegistrationRequests.AsNoTracking().Where(r => r.Id == id).Select(r => new RegistrationRequestDto
        {
            Id = r.Id, FullName = r.FullName, Email = r.Email, Mobile = r.Mobile, RequestedRole = r.RequestedRole, AdminEmail = r.AdminEmail, AdminUserId = r.AdminUserId, DeviceId = r.DeviceCode,
            AdminName = r.AdminUser != null ? r.AdminUser.Name : null, Status = r.Status, CreatedAt = r.CreatedAt, DecidedAt = r.DecidedAt,
            DecidedByName = r.DecidedBy != null ? r.DecidedBy.Name : null, DecisionNote = r.DecisionNote, ApprovedRole = r.ApprovedRole, UserId = r.UserId,
            ActivationStatus = r.User == null ? null : r.User.IsActive ? "Active" : r.User.EmailConfirmedAt == null ? "Pending activation" : "Inactive",
        }).FirstOrDefaultAsync(ct) ?? throw ApiException.NotFound("Registration request not found.");
        await EnrichDevicesAsync([dto], ct);
        return dto;
    }

    /// <summary>Tells the Super Admin, for each pending request, what the entered Device ID is: not registered yet (create it first), free, or already assigned to someone.</summary>
    private async Task EnrichDevicesAsync(IEnumerable<RegistrationRequestDto> items, CancellationToken ct)
    {
        var list = items.Where(i => !string.IsNullOrEmpty(i.DeviceId)).ToList();
        if (list.Count == 0) return;
        var codes = list.Select(i => i.DeviceId!).Distinct().ToList();
        var devices = await db.Devices.AsNoTracking().Where(d => codes.Contains(d.DeviceId)).Select(d => new { d.Id, d.DeviceId, d.IsActive }).ToListAsync(ct);
        var ids = devices.Select(d => d.Id).ToList();
        var owners = await db.DeviceAssignments.AsNoTracking().Where(a => a.IsActive && ids.Contains(a.DeviceRecordId)).Select(a => new { a.DeviceRecordId, a.User.Name }).ToListAsync(ct);
        foreach (var i in list)
        {
            var d = devices.FirstOrDefault(x => string.Equals(x.DeviceId, i.DeviceId, StringComparison.OrdinalIgnoreCase));
            if (d is null) { i.DeviceStatus = "NotRegistered"; continue; }
            i.DeviceId = d.DeviceId;
            var owner = owners.FirstOrDefault(o => o.DeviceRecordId == d.Id);
            i.DeviceStatus = !d.IsActive ? "Inactive" : owner is null ? "Free" : "Assigned";
            i.DeviceOwnerName = owner?.Name;
        }
    }

    /// <summary>
    /// The devices that will be assigned to a new account: the ones the Super Admin picked plus the Device ID the applicant entered. Every one must exist and be active, and none may be taken
    /// from someone else unless <paramref name="reassign"/> is set: a device that is free, or already belongs to the account's own Admin (or one of that Admin's Users), moves freely.
    /// </summary>
    private async Task<(List<int> Ids, List<string> Codes)> ResolveDevicesAsync(IEnumerable<int> picked, string? requestedCode, int? ownerAdminId, bool reassign, CancellationToken ct)
    {
        var ids = picked.Distinct().ToList();
        if (!string.IsNullOrWhiteSpace(requestedCode))
        {
            var dev = await db.Devices.AsNoTracking().FirstOrDefaultAsync(d => d.DeviceId == requestedCode, ct)
                      ?? throw ApiException.Conflict($"The device {requestedCode} is not registered yet. Create it on the Devices page first, or approve without assigning it.", "device_not_registered");
            if (!ids.Contains(dev.Id)) ids.Add(dev.Id);
        }
        if (ids.Count == 0) return ([], []);
        var devices = await db.Devices.AsNoTracking().Where(d => ids.Contains(d.Id)).Select(d => new { d.Id, d.DeviceId, d.IsActive }).ToListAsync(ct);
        if (devices.Count != ids.Count) throw ApiException.BadRequest("One of the selected devices does not exist.", "device_not_found");
        if (devices.Any(d => !d.IsActive)) throw ApiException.BadRequest("An inactive device cannot be assigned.", "device_inactive");
        if (!reassign)
        {
            var owners = await db.DeviceAssignments.AsNoTracking().Where(a => a.IsActive && ids.Contains(a.DeviceRecordId)).Select(a => new { a.DeviceRecordId, a.UserId, a.User.Name, a.User.ManagerId }).ToListAsync(ct);
            foreach (var o in owners)
            {
                var inOwnTree = ownerAdminId is { } adm && (o.UserId == adm || o.ManagerId == adm);
                if (!inOwnTree) throw ApiException.Conflict($"The device {devices.First(d => d.Id == o.DeviceRecordId).DeviceId} is already assigned to {o.Name}. Tick 'Reassign' to move it to the new account.", "device_already_assigned");
            }
        }
        return (ids, devices.Select(d => d.DeviceId).OrderBy(x => x, StringComparer.OrdinalIgnoreCase).ToList());
    }

    private async Task AssignDevicesAsync(User user, List<int> deviceIds, int assignerId, CancellationToken ct)
    {
        var ids = deviceIds.Distinct().ToList();
        if (ids.Count == 0) return;
        var devices = await db.Devices.Where(d => ids.Contains(d.Id)).ToListAsync(ct);
        if (devices.Count != ids.Count) throw ApiException.BadRequest("One of the selected devices does not exist.", "device_not_found");
        if (devices.Any(d => !d.IsActive)) throw ApiException.BadRequest("An inactive device cannot be assigned.", "device_inactive");
        var now = DateTime.UtcNow;
        var open = await db.DeviceAssignments.Where(a => ids.Contains(a.DeviceRecordId) && a.IsActive).ToListAsync(ct);
        foreach (var a in open) { a.IsActive = false; a.UnassignedAt = now; }
        await db.SaveChangesAsync(ct);                                  // close the old rows first (unique index: one active assignment per device)
        foreach (var d in devices)
            db.DeviceAssignments.Add(new DeviceAssignment { DeviceRecordId = d.Id, UserId = user.Id, AssignedByUserId = assignerId, AssignedAt = now, IsActive = true, Notes = "Assigned with the account" });
        await db.SaveChangesAsync(ct);
    }

    private static User NewAccount(string name, string emailAddr, string mobile, string role, int? managerId, string source, int approverId) => new()
    {
        Name = name, Email = emailAddr, Mobile = mobile, Role = role, ManagerId = role == Roles.User ? managerId : null,
        PasswordHash = BCrypt.Net.BCrypt.HashPassword(NewToken()),         // unusable: nobody knows it; the owner sets a real password when activating
        IsActive = false, Source = source, ApprovedAt = DateTime.UtcNow, ApprovedByUserId = approverId,
    };

    private async Task<User> RequireApprovedAdminAsync(string? adminEmailOrNull, int? adminId, CancellationToken ct)
    {
        var q = db.Users.AsQueryable();
        var admin = adminId is { } id ? await q.FirstOrDefaultAsync(u => u.Id == id && u.Role == Roles.Admin && u.IsActive, ct)
                  : await q.FirstOrDefaultAsync(u => u.Email == Norm(adminEmailOrNull) && u.Role == Roles.Admin && u.IsActive, ct);
        return admin ?? throw ApiException.BadRequest("A User needs an approved, active Admin. No such Admin was found.", "admin_not_found");
    }

    public async Task<RegistrationRequestDto> ApproveAsync(int id, ApproveRegistrationRequest req, CurrentUser caller, CancellationToken ct)
    {
        if (!caller.IsSuperAdmin) throw ApiException.Forbidden();
        var link = RequireBase();
        var r = await db.RegistrationRequests.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw ApiException.NotFound("Registration request not found.");
        if (r.Status != RegistrationStatus.Pending) throw ApiException.Conflict($"This request is already {r.Status.ToLowerInvariant()}.", "already_decided");
        var role = string.IsNullOrWhiteSpace(req.Role) ? r.RequestedRole : req.Role.Trim();
        if (role is not (Roles.Admin or Roles.User)) throw ApiException.BadRequest("Role must be 'Admin' or 'User'. A Super Admin account cannot be granted here.", "validation_failed");
        if (await db.Users.AnyAsync(u => u.Email == r.Email, ct)) throw ApiException.Conflict("An account with this email already exists.", "email_taken");

        User? admin = null;
        if (role == Roles.User) admin = await RequireApprovedAdminAsync(r.AdminEmail, req.AdminId ?? r.AdminUserId, ct);

        var (deviceIds, deviceCodes) = await ResolveDevicesAsync(req.DeviceIds, req.AssignRequestedDevice ? r.DeviceCode : null, admin?.Id, req.Reassign, ct);   // fails before anything is created

        User user; string token; DateTime expires;
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            user = NewAccount(r.FullName, r.Email, r.Mobile, role, admin?.Id, "Public", caller.Id);
            db.Users.Add(user);
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException ex) when (SqlErrors.IsUniqueViolation(ex)) { throw ApiException.Conflict("An account with this email already exists.", "email_taken"); }
            await AssignDevicesAsync(user, deviceIds, caller.Id, ct);
            (token, expires) = await NewInvitationAsync(user, caller.Id, ct);
            r.Status = RegistrationStatus.Approved; r.DecidedAt = DateTime.UtcNow; r.DecidedByUserId = caller.Id; r.DecisionNote = req.Note?.Trim();
            r.ApprovedRole = role; r.UserId = user.Id;
            History("Approved", caller.Id, r.Id, user.Id, $"{role}{(admin is null ? "" : $" under {admin.Email}")}; devices: {(deviceCodes.Count == 0 ? "none" : string.Join(", ", deviceCodes))}" + (role != r.RequestedRole ? $"; role changed from {r.RequestedRole}" : ""));
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        log.LogInformation("AUDIT registration {Id} approved as {Role} by SuperAdmin {CallerId}", r.Id, role, caller.Id);

        var word = RoleWord(role);
        await SendAsync("ApprovalActivation", Build(user.Email, "Your account is approved - set your password", "Your account is approved",
            new[] { $"Hello {H(user.Name)},", $"Your registration as <b>{word}</b> on LIVVAir Protect has been approved." }
              .Concat(deviceCodes.Count == 0 ? Array.Empty<string>() : new[] { $"Your device{(deviceCodes.Count > 1 ? "s" : "")} <b>{H(string.Join(", ", deviceCodes))}</b> {(deviceCodes.Count > 1 ? "have" : "has")} been assigned to you." })
              .Append($"Use the button below to create your password and activate your account. The link works once and expires in {_o.InvitationHours} hours.").ToArray(),
            "Activate my account", ActivationLink(token), "Your email address is your login. We never send passwords by email."), r.Id, user.Id, ct);
        if (admin is not null)
            await SendAsync("AdminUserApproved", Build(admin.Email, $"User approved under your account: {user.Name}", "A user was approved under your account",
                [$"Hello {H(admin.Name)},", $"<b>{H(user.Name)}</b> ({H(user.Email)}) was approved by the Super Admin and is now attached to your account." + (deviceCodes.Count == 0 ? "" : $" Device assigned: <b>{H(string.Join(", ", deviceCodes))}</b>."), "They will appear in your Users once they activate the account."]), r.Id, admin.Id, ct);
        await ToSuperAdminsAsync("SuperAdminApproval", $"{word} registration approved: {user.Name}", "Registration approved",
            [$"<b>{H(user.Name)}</b> ({H(user.Email)}) was approved as <b>{word}</b>" + (admin is null ? "." : $" under {H(admin.Name)} ({H(admin.Email)}).") + (deviceCodes.Count == 0 ? " No device was assigned." : $" Device assigned automatically: <b>{H(string.Join(", ", deviceCodes))}</b>."), $"The activation link was sent to the new account (valid {_o.InvitationHours} hours)."], r.Id, user.Id, ct);
        return await GetRequestAsync(r.Id, ct);
    }

    public async Task<RegistrationRequestDto> RejectAsync(int id, RejectRegistrationRequest req, CurrentUser caller, CancellationToken ct)
    {
        if (!caller.IsSuperAdmin) throw ApiException.Forbidden();
        var r = await db.RegistrationRequests.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw ApiException.NotFound("Registration request not found.");
        if (r.Status != RegistrationStatus.Pending) throw ApiException.Conflict($"This request is already {r.Status.ToLowerInvariant()}.", "already_decided");
        r.Status = RegistrationStatus.Rejected; r.DecidedAt = DateTime.UtcNow; r.DecidedByUserId = caller.Id;
        r.DecisionNote = string.IsNullOrWhiteSpace(req.Reason) ? null : req.Reason.Trim()[..Math.Min(500, req.Reason.Trim().Length)];
        History("Rejected", caller.Id, r.Id, null, r.DecisionNote);
        await db.SaveChangesAsync(ct);
        log.LogInformation("AUDIT registration {Id} rejected by SuperAdmin {CallerId}", r.Id, caller.Id);
        return await GetRequestAsync(r.Id, ct);
    }

    // ------------------------------------------------------------------ Super Admin: direct creation

    public async Task<InviteResultDto> InviteAsync(InviteUserRequest req, CurrentUser caller, CancellationToken ct)
    {
        if (!caller.IsSuperAdmin) throw ApiException.Forbidden();
        await inviteValidator.ValidateAndThrowAsync(req, ct);
        RequireBase();
        var emailAddr = Norm(req.Email);
        if (await db.Users.AnyAsync(u => u.Email == emailAddr, ct)) throw ApiException.Conflict("An account with this email already exists.", "email_taken");
        if (await db.RegistrationRequests.AnyAsync(r => r.Email == emailAddr && r.Status == RegistrationStatus.Pending, ct))
            throw ApiException.Conflict("This email has a registration waiting for approval. Approve that request instead.", "registration_pending");
        User? admin = req.Role == Roles.User ? await RequireApprovedAdminAsync(req.AdminEmail, null, ct) : null;
        var (deviceIds, deviceCodes) = await ResolveDevicesAsync(req.DeviceIds, null, admin?.Id, req.Reassign, ct);   // same device rules as an approved registration

        User user; string token; DateTime expires;
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            user = NewAccount(req.Name.Trim(), emailAddr, ContactRules.CleanMobile(req.Mobile), req.Role, admin?.Id, "Direct", caller.Id);   // approved at once: no public approval step
            db.Users.Add(user);
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException ex) when (SqlErrors.IsUniqueViolation(ex)) { throw ApiException.Conflict("An account with this email already exists.", "email_taken"); }
            await AssignDevicesAsync(user, deviceIds, caller.Id, ct);
            (token, expires) = await NewInvitationAsync(user, caller.Id, ct);
            History("DirectCreated", caller.Id, null, user.Id, $"{req.Role}{(admin is null ? "" : $" under {admin.Email}")}; devices: {(deviceCodes.Count == 0 ? "none" : string.Join(", ", deviceCodes))}");
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        log.LogInformation("AUDIT account {UserId} ({Role}) created directly by SuperAdmin {CallerId}", user.Id, user.Role, caller.Id);

        var word = RoleWord(user.Role);
        var outcome = new InviteResultDto { UserId = user.Id, Email = user.Email, Role = user.Role, ActivationStatus = "Pending activation", InvitationExpiresAt = expires };
        outcome.Emails.Add(await SendAsync("Invitation", Build(user.Email, "You are invited to LIVVAir Protect", "You are invited",
            new[] { $"Hello {H(user.Name)},", $"The Super Admin created a <b>{word}</b> account for you on LIVVAir Protect." }
              .Concat(deviceCodes.Count == 0 ? Array.Empty<string>() : new[] { $"Your device{(deviceCodes.Count > 1 ? "s" : "")} <b>{H(string.Join(", ", deviceCodes))}</b> {(deviceCodes.Count > 1 ? "have" : "has")} been assigned to you." })
              .Append($"Use the button below to create your password and activate your account. The link works once and expires in {_o.InvitationHours} hours.").ToArray(),
            "Activate my account", ActivationLink(token), "Your email address is your login. We never send passwords by email."), null, user.Id, ct));
        if (admin is not null)
            outcome.Emails.Add(await SendAsync("AdminNewUser", Build(admin.Email, $"New user added under your account: {user.Name}", "A user was added under your account",
                [$"Hello {H(admin.Name)},", $"The Super Admin created the User <b>{H(user.Name)}</b> ({H(user.Email)}) under your account." + (deviceCodes.Count == 0 ? "" : $" Device assigned: <b>{H(string.Join(", ", deviceCodes))}</b>."), "They will appear in your Users once they activate the account."]), null, admin.Id, ct));
        outcome.Emails.AddRange(await ToSuperAdminsAsync("SuperAdminCreated", $"{word} account created: {user.Name}", "Account created",
            [$"You created the {word} account <b>{H(user.Name)}</b> ({H(user.Email)})" + (admin is null ? "." : $" under {H(admin.Name)} ({H(admin.Email)})."), "An activation invitation was sent to the new account."], null, user.Id, ct));
        return outcome;
    }

    public async Task<InviteResultDto> ResendInvitationAsync(int userId, CurrentUser caller, CancellationToken ct)
    {
        if (!caller.IsSuperAdmin) throw ApiException.Forbidden();
        RequireBase();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct) ?? throw ApiException.NotFound("User not found.");
        if (user.IsActive || user.EmailConfirmedAt != null || user.ApprovedAt == null) throw ApiException.Conflict("This account is already activated.", "already_active");
        var (token, expires) = await NewInvitationAsync(user, caller.Id, ct);
        History("InvitationResent", caller.Id, null, user.Id, null);
        await db.SaveChangesAsync(ct);
        var o = new InviteResultDto { UserId = user.Id, Email = user.Email, Role = user.Role, ActivationStatus = "Pending activation", InvitationExpiresAt = expires };
        o.Emails.Add(await SendAsync("Invitation", Build(user.Email, "Your LIVVAir Protect activation link", "Activate your account",
            [$"Hello {H(user.Name)},", $"Here is a new activation link for your <b>{RoleWord(user.Role)}</b> account. Earlier links no longer work. This one works once and expires in {_o.InvitationHours} hours."],
            "Activate my account", ActivationLink(token), "Your email address is your login. We never send passwords by email."), null, user.Id, ct));
        return o;
    }

    // ------------------------------------------------------------------ activation (public)

    public async Task<ActivationCheckResponse> CheckActivationAsync(string? token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 200) return new ActivationCheckResponse();
        var hash = JwtService.Hash(token.Trim());
        var inv = await db.AccountInvitations.AsNoTracking().Where(i => i.TokenHash == hash).Select(i => new { i.UsedAt, i.RevokedAt, i.ExpiresAt, i.User.Name, i.User.Email, i.User.Role, i.User.IsActive }).FirstOrDefaultAsync(ct);
        if (inv is null || inv.UsedAt != null || inv.RevokedAt != null || inv.ExpiresAt <= DateTime.UtcNow || inv.IsActive) return new ActivationCheckResponse();
        return new ActivationCheckResponse { Valid = true, Name = inv.Name, Email = inv.Email, Role = inv.Role };
    }

    /// <summary>Sets the password of an approved account and activates it. The token is consumed by one atomic UPDATE, so it can never be used twice, even in parallel.</summary>
    public async Task ActivateAsync(ActivateRequest req, CancellationToken ct)
    {
        await activateValidator.ValidateAndThrowAsync(req, ct);
        var hash = JwtService.Hash(req.Token.Trim());
        var now = DateTime.UtcNow;
        var inv = await db.AccountInvitations.AsNoTracking().Where(i => i.TokenHash == hash).Select(i => new { i.Id, i.UserId, i.UsedAt, i.RevokedAt, i.ExpiresAt }).FirstOrDefaultAsync(ct);
        const string bad = "This activation link is invalid, already used, or has expired. Ask your administrator to send a new one.";
        if (inv is null || inv.UsedAt != null || inv.RevokedAt != null || inv.ExpiresAt <= now) throw ApiException.BadRequest(bad, "invalid_activation");

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var claimed = await db.AccountInvitations.Where(i => i.Id == inv.Id && i.UsedAt == null && i.RevokedAt == null && i.ExpiresAt > now)
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.UsedAt, now), ct);
        if (claimed == 0) throw ApiException.BadRequest(bad, "invalid_activation");
        var user = await db.Users.FirstAsync(u => u.Id == inv.UserId, ct);
        if (user.ApprovedAt == null || user.IsActive) throw ApiException.BadRequest(bad, "invalid_activation");
        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password);
        user.IsActive = true; user.EmailConfirmedAt = now; user.UpdatedAt = now;
        user.FailedLoginCount = 0; user.LockoutUntil = null;
        History("Activated", user.Id, null, user.Id, "Email verified, password set");
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        log.LogInformation("AUDIT account {UserId} ({Role}) activated", user.Id, user.Role);
    }

    // ------------------------------------------------------------------ Super Admin: link, history, mapping

    public RegistrationLinkDto GetLink() => new() { Url = RegisterLink(), EmailConfigured = true };

    public async Task<EmailOutcomeDto> SendLinkAsync(SendRegistrationLinkRequest req, CurrentUser caller, CancellationToken ct)
    {
        if (!caller.IsSuperAdmin) throw ApiException.Forbidden();
        await linkValidator.ValidateAndThrowAsync(req, ct);
        var to = Norm(req.Email);
        var link = RegisterLink();
        var o = await SendAsync("RegistrationLink", Build(to, "Register on LIVVAir Protect", "You are invited to register",
            ["You can register for a LIVVAir Protect account with the button below. Choose Admin or User, fill in your details, and the Super Admin will approve your request.", "If you register as a User you will need the email address of your Admin."],
            "Register", link), null, null, ct);
        History("RegistrationLinkSent", caller.Id, null, null, "Registration link emailed to " + LogRedactor.MaskEmail(to) + " (" + o.Status + ")");
        await db.SaveChangesAsync(ct);
        if (o.Status != "Sent") throw new ApiException(502, "email_not_sent", o.Status == "NotConfigured" ? "Email sending is not configured on this server yet." : "The email could not be sent. Check the email settings and try again.");
        return o;
    }

    public Task<PagedResult<AccountHistoryDto>> HistoryAsync(HistoryQuery2 q, CancellationToken ct)
    {
        var query = db.AccountHistory.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(q.Action)) query = query.Where(h => h.Action == q.Action);
        return query.OrderByDescending(h => h.At).ThenByDescending(h => h.Id).Select(h => new AccountHistoryDto
        {
            Id = h.Id, At = h.At, Action = h.Action, ActorName = h.Actor != null ? h.Actor.Name : null, RequestId = h.RequestId, TargetUserId = h.TargetUserId,
            TargetName = h.TargetUser != null ? h.TargetUser.Name : null, Detail = h.Detail,
        }).ToPagedAsync(q, ct);
    }

    public Task<PagedResult<EmailLogDto>> EmailLogAsync(PageQuery q, CancellationToken ct) =>
        db.EmailLogs.AsNoTracking().OrderByDescending(e => e.At).ThenByDescending(e => e.Id)
            .Select(e => new EmailLogDto { Id = e.Id, At = e.At, ToEmail = e.ToEmail, Subject = e.Subject, Template = e.Template, Status = e.Status, Error = e.Error }).ToPagedAsync(q, ct);

    /// <summary>Which Users belong to which Admin (and the Users managed directly by the Super Admin), with each User's devices and activation status.</summary>
    public async Task<List<AdminMappingDto>> MappingAsync(CancellationToken ct)
    {
        var people = await db.Users.AsNoTracking().Where(u => u.Role != Roles.SuperAdmin)
            .Select(u => new { u.Id, u.Name, u.Email, u.Role, u.ManagerId, ManagerRole = u.Manager != null ? u.Manager.Role : null, u.IsActive, u.EmailConfirmedAt }).ToListAsync(ct);
        var devices = await db.DeviceAssignments.AsNoTracking().Where(a => a.IsActive).Select(a => new { a.UserId, a.Device.DeviceId }).ToListAsync(ct);
        var byUser = devices.GroupBy(d => d.UserId).ToDictionary(g => g.Key, g => g.Select(x => x.DeviceId).OrderBy(x => x).ToList());
        var result = people.Where(p => p.Role == Roles.Admin).OrderBy(a => a.Name).Select(a => new AdminMappingDto
        {
            AdminId = a.Id, AdminName = a.Name, AdminEmail = a.Email, AdminStatus = ActivationStatusOf(a.IsActive, a.EmailConfirmedAt),
            Users = people.Where(p => p.Role == Roles.User && p.ManagerId == a.Id).OrderBy(p => p.Name).Select(p => new MappedUserDto
                { Id = p.Id, Name = p.Name, Email = p.Email, ActivationStatus = ActivationStatusOf(p.IsActive, p.EmailConfirmedAt), Devices = byUser.GetValueOrDefault(p.Id) ?? [] }).ToList(),
        }).ToList();
        var standalone = people.Where(p => p.Role == Roles.User && p.ManagerRole == Roles.SuperAdmin).OrderBy(p => p.Name).Select(p => new MappedUserDto
            { Id = p.Id, Name = p.Name, Email = p.Email, ActivationStatus = ActivationStatusOf(p.IsActive, p.EmailConfirmedAt), Devices = byUser.GetValueOrDefault(p.Id) ?? [] }).ToList();
        if (standalone.Count > 0) result.Add(new AdminMappingDto { AdminId = null, AdminName = "Managed directly by the Super Admin", Users = standalone });
        return result;
    }
}
