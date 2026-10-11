using Microsoft.EntityFrameworkCore;
using VayuVata.Models;

namespace VayuVata.Data;

public static class DbInitializer
{
    /// <summary>
    /// Creates the first SuperAdmin from configuration (Bootstrap:SuperAdminEmail / SuperAdminPassword /
    /// SuperAdminName) when no SuperAdmin exists. Credentials come from env vars or user-secrets only;
    /// nothing is hardcoded. Does nothing when the values are not supplied.
    /// </summary>
    public static async Task BootstrapSuperAdminAsync(IServiceProvider sp, ILogger log)
    {
        var db = sp.GetRequiredService<VayuVataDbContext>();
        var cfg = sp.GetRequiredService<IConfiguration>().GetSection("Bootstrap");
        if (await db.Users.AnyAsync(u => u.Role == Roles.SuperAdmin)) return;

        var email = cfg["SuperAdminEmail"]?.Trim().ToLowerInvariant();
        var password = cfg["SuperAdminPassword"];
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
        {
            log.LogWarning("No SuperAdmin exists and Bootstrap:SuperAdminEmail/SuperAdminPassword are not set. Nobody can log in until one is created.");
            return;
        }
        if (password.Length < 10) throw new InvalidOperationException("Bootstrap:SuperAdminPassword must be at least 10 characters.");

        db.Users.Add(new User
        {
            Name = cfg["SuperAdminName"] ?? "Super Admin",
            Email = email,
            Role = Roles.SuperAdmin,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
        });
        await db.SaveChangesAsync();
        log.LogInformation("Bootstrap SuperAdmin {Email} created.", email);
    }
}
