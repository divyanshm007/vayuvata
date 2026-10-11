using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace VayuVata.Migrations
{
    /// <summary>
    /// Replaces Users.AdminId with Users.ManagerId.
    ///   - SuperAdmin / Admin: ManagerId NULL.
    ///   - User managed by an Admin: ManagerId = that Admin (copied from AdminId).
    ///   - Standalone User: ManagerId = the SuperAdmin (new rows only; see guard below).
    /// Data is copied and verified BEFORE the old column is dropped. Reversible (Down restores AdminId).
    /// </summary>
    public partial class ManagerHierarchy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Guard: a legacy standalone User (Role=User, AdminId NULL) has no manager yet. Assigning one would be a guess,
            // so stop and report the affected ids instead of migrating.
            migrationBuilder.Sql(@"
IF EXISTS (SELECT 1 FROM dbo.Users WHERE Role = 'User' AND AdminId IS NULL)
BEGIN
    DECLARE @ids nvarchar(max) = (SELECT STRING_AGG(CAST(Id AS nvarchar(20)), ',') FROM dbo.Users WHERE Role = 'User' AND AdminId IS NULL);
    DECLARE @msg nvarchar(2000) = CONCAT('Migration ManagerHierarchy stopped: legacy standalone Users (Role=User, AdminId NULL) need an explicit manager before migrating. Affected Users.Id: ', @ids, '. Assign each to an Admin or to the SuperAdmin, then re-run.');
    THROW 51001, @msg, 1;
END");

            migrationBuilder.AddColumn<int>(name: "ManagerId", table: "Users", type: "int", nullable: true);

            // Copy and verify the existing Admin -> User relationships.
            migrationBuilder.Sql("UPDATE dbo.Users SET ManagerId = AdminId WHERE AdminId IS NOT NULL;");
            migrationBuilder.Sql(@"
IF EXISTS (SELECT 1 FROM dbo.Users WHERE ISNULL(ManagerId, -1) <> ISNULL(AdminId, -1))
    THROW 51002, 'Migration ManagerHierarchy stopped: ManagerId does not match AdminId after copy.', 1;");

            // Only now remove the old column and its dependents.
            migrationBuilder.DropForeignKey(name: "FK_Users_Users_AdminId", table: "Users");
            migrationBuilder.DropCheckConstraint(name: "CK_Users_AdminId", table: "Users");
            migrationBuilder.DropIndex(name: "IX_Users_AdminId", table: "Users");
            migrationBuilder.DropColumn(name: "AdminId", table: "Users");

            migrationBuilder.CreateIndex(name: "IX_Users_ManagerId", table: "Users", column: "ManagerId");
            migrationBuilder.AddForeignKey(
                name: "FK_Users_Users_ManagerId", table: "Users", column: "ManagerId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddCheckConstraint(
                name: "CK_Users_Manager", table: "Users",
                sql: "(([Role] = 'User' AND [ManagerId] IS NOT NULL AND [ManagerId] <> [Id]) OR ([Role] IN ('SuperAdmin','Admin') AND [ManagerId] IS NULL))");

            // A User's manager must be an Admin or SuperAdmin (cross-row rule; CHECK cannot express it).
            // Because managers themselves have ManagerId NULL (CK_Users_Manager), self-assignment and cycles are impossible.
            migrationBuilder.Sql(@"
EXEC(N'
CREATE TRIGGER dbo.TR_Users_ManagerRules ON dbo.Users AFTER INSERT, UPDATE AS
BEGIN
    SET NOCOUNT ON;
    IF UPDATE(ManagerId) OR UPDATE(Role)
    BEGIN
        IF EXISTS (SELECT 1 FROM inserted i
                   WHERE i.Role = ''User''
                     AND NOT EXISTS (SELECT 1 FROM dbo.Users m WHERE m.Id = i.ManagerId AND m.Role IN (''Admin'', ''SuperAdmin'')))
            THROW 51010, ''A User must be managed by an Admin or the SuperAdmin.'', 1;
        IF EXISTS (SELECT 1 FROM inserted i JOIN dbo.Users u ON u.ManagerId = i.Id WHERE i.Role = ''User'')
            THROW 51011, ''An account that manages Users cannot be a regular User.'', 1;
    END
END');");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TRIGGER IF EXISTS dbo.TR_Users_ManagerRules;");
            migrationBuilder.DropForeignKey(name: "FK_Users_Users_ManagerId", table: "Users");
            migrationBuilder.DropCheckConstraint(name: "CK_Users_Manager", table: "Users");
            migrationBuilder.DropIndex(name: "IX_Users_ManagerId", table: "Users");

            migrationBuilder.AddColumn<int>(name: "AdminId", table: "Users", type: "int", nullable: true);
            // Admin-managed Users keep their Admin. Users managed by the SuperAdmin become AdminId NULL (the old "standalone").
            migrationBuilder.Sql("UPDATE u SET u.AdminId = u.ManagerId FROM dbo.Users u JOIN dbo.Users m ON m.Id = u.ManagerId WHERE m.Role = 'Admin';");
            migrationBuilder.Sql(@"
IF EXISTS (SELECT 1 FROM dbo.Users u JOIN dbo.Users m ON m.Id = u.ManagerId WHERE m.Role = 'Admin' AND ISNULL(u.AdminId, -1) <> u.ManagerId)
    THROW 51003, 'Down migration stopped: AdminId does not match ManagerId after copy.', 1;");
            migrationBuilder.DropColumn(name: "ManagerId", table: "Users");

            migrationBuilder.CreateIndex(name: "IX_Users_AdminId", table: "Users", column: "AdminId");
            migrationBuilder.AddForeignKey(
                name: "FK_Users_Users_AdminId", table: "Users", column: "AdminId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddCheckConstraint(
                name: "CK_Users_AdminId", table: "Users",
                sql: "([AdminId] IS NULL OR ([Role] = 'User' AND [AdminId] <> [Id]))");
        }
    }
}
