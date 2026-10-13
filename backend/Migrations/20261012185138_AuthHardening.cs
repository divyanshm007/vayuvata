using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace VayuVata.Migrations
{
    /// <inheritdoc />
    public partial class AuthHardening : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // IX_Devices_DeviceId duplicates the alternate key AK_Devices_DeviceId (unique on the same column, also the target of the
            // SensorData foreign key). Drop it only if the alternate key is really there, so uniqueness can never be lost.
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM sys.key_constraints k
               JOIN sys.index_columns ic ON ic.object_id = k.parent_object_id AND ic.index_id = k.unique_index_id
               JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
               WHERE k.name = 'AK_Devices_DeviceId' AND k.type = 'UQ' AND k.parent_object_id = OBJECT_ID('dbo.Devices') AND c.name = 'DeviceId')
    THROW 51010, 'Migration AuthHardening stopped: unique constraint AK_Devices_DeviceId is missing, so IX_Devices_DeviceId must not be dropped.', 1;");

            migrationBuilder.DropIndex(
                name: "IX_Devices_DeviceId",
                table: "Devices");

            migrationBuilder.AddColumn<int>(
                name: "FailedLoginCount",
                table: "Users",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastFailedLoginAt",
                table: "Users",
                type: "datetime2(3)",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LockoutUntil",
                table: "Users",
                type: "datetime2(3)",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "FamilyId",
                table: "RefreshTokens",
                type: "uniqueidentifier",
                nullable: false,
                defaultValueSql: "NEWID()");

            migrationBuilder.AddColumn<int>(
                name: "ReplacedByTokenId",
                table: "RefreshTokens",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_RefreshTokens_ExpiresAt",
                table: "RefreshTokens",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_RefreshTokens_FamilyId",
                table: "RefreshTokens",
                column: "FamilyId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_RefreshTokens_ExpiresAt",
                table: "RefreshTokens");

            migrationBuilder.DropIndex(
                name: "IX_RefreshTokens_FamilyId",
                table: "RefreshTokens");

            migrationBuilder.DropColumn(
                name: "FailedLoginCount",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "LastFailedLoginAt",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "LockoutUntil",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "FamilyId",
                table: "RefreshTokens");

            migrationBuilder.DropColumn(
                name: "ReplacedByTokenId",
                table: "RefreshTokens");

            migrationBuilder.CreateIndex(
                name: "IX_Devices_DeviceId",
                table: "Devices",
                column: "DeviceId",
                unique: true);
        }
    }
}
