using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace VayuVata.Data;

/// <summary>
/// The ONLY supported way to change the database schema. Runs outside the web host, with a dedicated migration connection string
/// (<c>ConnectionStrings:Migration</c>, a login that may alter the schema) - the runtime API login cannot.
///
///   VayuVata --migration-status   lists applied / pending migrations and changes nothing
///   VayuVata --migrate            applies pending migrations; safe to repeat (already-applied migrations are skipped by EF history)
///
/// Guards: the target database must be named VayuVata, and ASPNETCORE_ENVIRONMENT=Production is refused unless
/// Database:AllowProductionMigration=true is set explicitly. Nothing is ever dropped or recreated by this command.
/// </summary>
public static class MigrationRunner
{
    public static bool IsMigrationCommand(string[] args) => args is ["--migrate"] or ["--migration-status"];

    public static async Task<int> RunAsync(string[] args, IConfiguration config, string environment)
    {
        var statusOnly = args[0] == "--migration-status";
        var cs = config.GetConnectionString("Migration");
        if (string.IsNullOrWhiteSpace(cs))
        {
            Console.Error.WriteLine("ConnectionStrings:Migration is not set. Provide it via the environment variable ConnectionStrings__Migration.");
            return 2;
        }

        SqlConnectionStringBuilder sb;
        try { sb = new SqlConnectionStringBuilder(cs); }
        catch (ArgumentException) { Console.Error.WriteLine("ConnectionStrings:Migration is not a valid SQL Server connection string."); return 2; }

        if (!string.Equals(sb.InitialCatalog, "VayuVata", StringComparison.OrdinalIgnoreCase))
        {
            Console.Error.WriteLine($"Refusing to run: the migration target database is '{sb.InitialCatalog}', expected 'VayuVata'.");
            return 2;
        }
        if (string.Equals(environment, "Production", StringComparison.OrdinalIgnoreCase) && !config.GetValue<bool>("Database:AllowProductionMigration"))
        {
            Console.Error.WriteLine("Refusing to run migrations with ASPNETCORE_ENVIRONMENT=Production (set Database:AllowProductionMigration=true only after explicit approval).");
            return 2;
        }

        var options = new DbContextOptionsBuilder<VayuVataDbContext>().UseSqlServer(cs).Options;
        await using var db = new VayuVataDbContext(options);
        try
        {
            Console.WriteLine($"Target: server '{sb.DataSource}', database '{sb.InitialCatalog}', login '{sb.UserID}' (environment {environment})");
            var applied = (await db.Database.GetAppliedMigrationsAsync()).ToList();
            var pending = (await db.Database.GetPendingMigrationsAsync()).ToList();
            Console.WriteLine($"Applied migrations ({applied.Count}): {string.Join(", ", applied)}");
            Console.WriteLine($"Pending migrations ({pending.Count}): {(pending.Count == 0 ? "none" : string.Join(", ", pending))}");
            if (statusOnly) return 0;
            if (pending.Count == 0) { Console.WriteLine("Database is up to date; nothing to apply."); return 0; }

            await db.Database.MigrateAsync();
            Console.WriteLine($"Applied {pending.Count} migration(s) successfully.");
            return 0;
        }
        catch (Exception ex)
        {
            // The message of a SqlException does not contain credentials; no stack trace is printed.
            Console.Error.WriteLine($"Migration failed: {ex.GetBaseException().Message}");
            return 1;
        }
    }
}
