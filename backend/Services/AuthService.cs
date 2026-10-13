using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using VayuVata.Data;
using VayuVata.DTOs.Auth;
using VayuVata.Helpers;
using VayuVata.Models;
using VayuVata.Validators;

namespace VayuVata.Services;

/// <summary>Account lockout policy. Temporary by design: the lock expires on its own, so it cannot be abused for permanent denial of service.</summary>
public class AuthOptions
{
    /// <summary>Consecutive wrong passwords (inside the window) that trigger a lockout.</summary>
    public int MaxFailedAttempts { get; set; } = 5;
    /// <summary>Lockout length, and also the window in which failures are counted.</summary>
    public int LockoutMinutes { get; set; } = 15;
}

public class AuthService(
    VayuVataDbContext db, JwtService jwt,
    IValidator<LoginRequest> loginValidator, IValidator<RefreshRequest> refreshValidator,
    IValidator<ChangePasswordRequest> changePasswordValidator,
    IOptions<AuthOptions> authOptions, ILogger<AuthService> log)
{
    private readonly AuthOptions _auth = authOptions.Value;

    // Verified against when the email is unknown so response time does not reveal which emails exist.
    private static readonly string DummyHash = BCrypt.Net.BCrypt.HashPassword("dummy-password-for-timing");

    public async Task<LoginResponse> LoginAsync(LoginRequest req, CancellationToken ct)
    {
        await loginValidator.ValidateAndThrowAsync(req, ct);
        var email = req.Email.Trim().ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);
        var now = DateTime.UtcNow;

        // Always run BCrypt (real or dummy hash) so unknown / locked / disabled accounts cost the same time as a wrong password.
        var passwordOk = BCrypt.Net.BCrypt.Verify(req.Password, user?.PasswordHash ?? DummyHash);
        var locked = user?.LockoutUntil > now;

        if (user is null || locked || !passwordOk || !user.IsActive)
        {
            // The client always sees the same 401 - it cannot tell unknown, wrong password, locked or disabled apart.
            // The reason is logged server-side only (e-mail masked).
            var reason = user is null ? "unknown_account" : locked ? "locked" : !user.IsActive ? "disabled" : "wrong_password";
            log.LogWarning("Failed login for {Email}: {Reason}", LogRedactor.MaskEmail(email), reason);
            if (user is not null && !locked && !passwordOk) await RegisterFailureAsync(user.Id, now, ct);
            throw ApiException.Unauthorized("Invalid email or password.");
        }

        user.LastLoginAt = now;
        ClearFailures(user);
        var response = await IssueAsync(user, Guid.NewGuid(), ct);
        log.LogInformation("User {UserId} ({Role}) logged in", user.Id, user.Role);
        return response;
    }

    /// <summary>
    /// Rotates a refresh token. Each token is single-use. Presenting a token that was already rotated is treated as theft:
    /// the whole token family (every descendant of that login) is revoked. The rotation itself is one atomic
    /// "UPDATE ... WHERE RevokedAt IS NULL", so two concurrent refreshes with the same token can never both succeed.
    /// </summary>
    public async Task<LoginResponse> RefreshAsync(RefreshRequest req, CancellationToken ct)
    {
        await refreshValidator.ValidateAndThrowAsync(req, ct);
        var hash = JwtService.Hash(req.RefreshToken);
        var token = await db.RefreshTokens.Include(t => t.User).FirstOrDefaultAsync(t => t.TokenHash == hash, ct);
        var now = DateTime.UtcNow;
        if (token is null) throw ApiException.Unauthorized("Invalid or expired refresh token.");

        if (token.RevokedAt is not null)
        {
            if (token.ReplacedByTokenId is not null) await HandleReuseAsync(token, now, ct);
            throw ApiException.Unauthorized("Invalid or expired refresh token.");
        }
        if (token.ExpiresAt <= now || !token.User.IsActive)
            throw ApiException.Unauthorized("Invalid or expired refresh token.");

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var (access, expires) = jwt.CreateAccessToken(token.User);
        var (raw, newHash, refreshExpires) = jwt.CreateRefreshToken();
        var next = new RefreshToken { UserId = token.UserId, TokenHash = newHash, ExpiresAt = refreshExpires, FamilyId = token.FamilyId };
        db.RefreshTokens.Add(next);
        await db.SaveChangesAsync(ct);

        var tokenId = token.Id;
        var claimed = await db.RefreshTokens.Where(t => t.Id == tokenId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now).SetProperty(t => t.ReplacedByTokenId, next.Id), ct);
        if (claimed == 0)
        {
            // Lost a race with another request using the same token: only one chain may continue, so end the family.
            await tx.RollbackAsync(ct);
            await HandleReuseAsync(token, now, ct);
            throw ApiException.Unauthorized("Invalid or expired refresh token.");
        }
        await tx.CommitAsync(ct);

        return Response(token.User, access, expires, raw, refreshExpires);
    }

    private async Task HandleReuseAsync(RefreshToken token, DateTime now, CancellationToken ct)
    {
        var family = token.FamilyId;
        var revoked = await db.RefreshTokens.Where(t => t.FamilyId == family && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct);
        log.LogWarning("SECURITY refresh-token reuse detected for user {UserId}; token family revoked ({Revoked} active token(s))", token.UserId, revoked);
    }

    public async Task LogoutAsync(int userId, RefreshRequest req, CancellationToken ct)
    {
        await refreshValidator.ValidateAndThrowAsync(req, ct);
        var hash = JwtService.Hash(req.RefreshToken);
        var token = await db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash && t.UserId == userId, ct);
        if (token is { RevokedAt: null })
        {
            token.RevokedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
        }
    }

    /// <summary>
    /// Changes the CALLER's password (the target is always the authenticated user; no user id is accepted). On success every existing
    /// refresh token of the user is revoked (all other sessions end once their 15-minute access token expires) and a fresh session is
    /// returned so the caller stays signed in.
    /// </summary>
    public async Task<LoginResponse> ChangePasswordAsync(int userId, ChangePasswordRequest req, CancellationToken ct)
    {
        await changePasswordValidator.ValidateAndThrowAsync(req, ct);
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, ct) ?? throw ApiException.Unauthorized();
        var now = DateTime.UtcNow;

        if (user.LockoutUntil > now)
            throw ApiException.TooManyRequests("Too many failed attempts. Try again later.", "account_locked");
        if (!BCrypt.Net.BCrypt.Verify(req.CurrentPassword, user.PasswordHash))
        {
            await RegisterFailureAsync(user.Id, now, ct);   // a stolen access token must not allow unlimited guessing of the password
            log.LogWarning("Wrong current password on change-password for user {UserId}", user.Id);
            throw ApiException.BadRequest("The current password is incorrect.", "current_password_incorrect");
        }

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.NewPassword);
        user.UpdatedAt = now;
        ClearFailures(user);
        await db.SaveChangesAsync(ct);
        await db.RefreshTokens.Where(t => t.UserId == userId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct);
        var response = await IssueAsync(user, Guid.NewGuid(), ct);
        await tx.CommitAsync(ct);
        log.LogInformation("User {UserId} changed their password; previous sessions revoked", user.Id);
        return response;
    }

    public async Task<ProfileResponse> MeAsync(int userId, CancellationToken ct)
    {
        var u = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == userId, ct)
                ?? throw ApiException.Unauthorized();
        return new ProfileResponse
        {
            Id = u.Id, Name = u.Name, Email = u.Email, Role = u.Role,
            ManagerId = u.ManagerId, IsActive = u.IsActive, LastLoginAt = u.LastLoginAt,
        };
    }

    private static void ClearFailures(User user)
    {
        user.FailedLoginCount = 0;
        user.LastFailedLoginAt = null;
        user.LockoutUntil = null;
    }

    /// <summary>
    /// Atomic failure counter (single UPDATE, safe under concurrent attempts). Failures older than the window - or since an expired
    /// lock - start a new count. Reaching MaxFailedAttempts sets LockoutUntil. Failures while locked are not counted, so the lock
    /// cannot be extended indefinitely by an attacker.
    /// </summary>
    private async Task RegisterFailureAsync(int userId, DateTime now, CancellationToken ct)
    {
        var windowStart = now.AddMinutes(-_auth.LockoutMinutes);
        var lockUntil = now.AddMinutes(_auth.LockoutMinutes);
        var max = _auth.MaxFailedAttempts;
        await db.Database.ExecuteSqlInterpolatedAsync($@"
UPDATE Users SET
  FailedLoginCount = CASE WHEN LastFailedLoginAt IS NULL OR LastFailedLoginAt < {windowStart} OR (LockoutUntil IS NOT NULL AND LockoutUntil <= {now}) THEN 1 ELSE FailedLoginCount + 1 END,
  LockoutUntil = CASE WHEN (CASE WHEN LastFailedLoginAt IS NULL OR LastFailedLoginAt < {windowStart} OR (LockoutUntil IS NOT NULL AND LockoutUntil <= {now}) THEN 1 ELSE FailedLoginCount + 1 END) >= {max} THEN {lockUntil} ELSE LockoutUntil END,
  LastFailedLoginAt = {now}
WHERE Id = {userId}", ct);
    }

    private async Task<LoginResponse> IssueAsync(User user, Guid family, CancellationToken ct)
    {
        var (access, expires) = jwt.CreateAccessToken(user);
        var (raw, hash, refreshExpires) = jwt.CreateRefreshToken();
        db.RefreshTokens.Add(new RefreshToken { UserId = user.Id, TokenHash = hash, ExpiresAt = refreshExpires, FamilyId = family });
        await db.SaveChangesAsync(ct);
        return Response(user, access, expires, raw, refreshExpires);
    }

    private static LoginResponse Response(User user, string access, DateTime expires, string raw, DateTime refreshExpires) => new()
    {
        AccessToken = access, ExpiresAt = expires,
        RefreshToken = raw, RefreshTokenExpiresAt = refreshExpires,
        UserId = user.Id, Name = user.Name, Email = user.Email, Role = user.Role,
    };
}
