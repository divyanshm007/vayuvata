using FluentValidation;
using Microsoft.EntityFrameworkCore;
using VayuVata.Data;
using VayuVata.DTOs.Auth;
using VayuVata.Helpers;
using VayuVata.Models;

namespace VayuVata.Services;

public class AuthService(
    VayuVataDbContext db, JwtService jwt,
    IValidator<LoginRequest> loginValidator, IValidator<RefreshRequest> refreshValidator,
    ILogger<AuthService> log)
{
    // Verified against when the email is unknown so response time does not reveal which emails exist.
    private static readonly string DummyHash = BCrypt.Net.BCrypt.HashPassword("dummy-password-for-timing");

    public async Task<LoginResponse> LoginAsync(LoginRequest req, CancellationToken ct)
    {
        await loginValidator.ValidateAndThrowAsync(req, ct);
        var email = req.Email.Trim().ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);

        var ok = BCrypt.Net.BCrypt.Verify(req.Password, user?.PasswordHash ?? DummyHash);
        if (user is null || !ok || !user.IsActive)
        {
            log.LogWarning("Failed login for {Email}", email);
            throw ApiException.Unauthorized("Invalid email or password.");
        }

        user.LastLoginAt = DateTime.UtcNow;
        var response = await IssueAsync(user, ct);
        log.LogInformation("User {UserId} ({Role}) logged in", user.Id, user.Role);
        return response;
    }

    public async Task<LoginResponse> RefreshAsync(RefreshRequest req, CancellationToken ct)
    {
        await refreshValidator.ValidateAndThrowAsync(req, ct);
        var hash = JwtService.Hash(req.RefreshToken);
        var token = await db.RefreshTokens.Include(t => t.User).FirstOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (token is null || !token.IsUsable(DateTime.UtcNow) || !token.User.IsActive)
            throw ApiException.Unauthorized("Invalid or expired refresh token.");

        token.RevokedAt = DateTime.UtcNow;   // rotation: each refresh token is single-use
        return await IssueAsync(token.User, ct);
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

    private async Task<LoginResponse> IssueAsync(User user, CancellationToken ct)
    {
        var (access, expires) = jwt.CreateAccessToken(user);
        var (raw, hash, refreshExpires) = jwt.CreateRefreshToken();
        db.RefreshTokens.Add(new RefreshToken { UserId = user.Id, TokenHash = hash, ExpiresAt = refreshExpires });
        await db.SaveChangesAsync(ct);
        return new LoginResponse
        {
            AccessToken = access, ExpiresAt = expires,
            RefreshToken = raw, RefreshTokenExpiresAt = refreshExpires,
            UserId = user.Id, Name = user.Name, Email = user.Email, Role = user.Role,
        };
    }
}

