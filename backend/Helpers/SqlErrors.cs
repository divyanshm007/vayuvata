using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace VayuVata.Helpers;

public static class SqlErrors
{
    /// <summary>SQL Server error 2601/2627: unique index / constraint violation.</summary>
    public static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is SqlException { Number: 2601 or 2627 };
}
