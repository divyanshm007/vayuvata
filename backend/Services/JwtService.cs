using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using VayuVata.Models;

namespace VayuVata.Services;

public class JwtOptions
{
    public string Issuer { get; set; } = "VayuVata";
    public string Audience { get; set; } = "VayuVata.Clients";
    /// <summary>HMAC signing key (min 32 chars). Supply via environment / user-secrets, never source control.</summary>
    public string Key { get; set; } = "";
    public int AccessTokenMinutes { get; set; } = 15;
    public int RefreshTokenDays { get; set; } = 7;
}

public class JwtService(IOptions<JwtOptions> options)
{
    private readonly JwtOptions _o = options.Value;

    public (string Token, DateTime ExpiresAt) CreateAccessToken(User user)
    {
        var expires = DateTime.UtcNow.AddMinutes(_o.AccessTokenMinutes);
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = _o.Issuer,
            Audience = _o.Audience,
            Expires = expires,
            Subject = new ClaimsIdentity(
            [
                new Claim("sub", user.Id.ToString()),
                new Claim("role", user.Role),
                new Claim("email", user.Email),
                new Claim("name", user.Name),
            ]),
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_o.Key)), SecurityAlgorithms.HmacSha256),
        };
        return (new JsonWebTokenHandler().CreateToken(descriptor), expires);
    }

    public (string Raw, string Hash, DateTime ExpiresAt) CreateRefreshToken()
    {
        var raw = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
        return (raw, Hash(raw), DateTime.UtcNow.AddDays(_o.RefreshTokenDays));
    }

    /// <summary>SHA-256 hex. Used for refresh tokens and device API keys (both are high-entropy random values).</summary>
    public static string Hash(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}
