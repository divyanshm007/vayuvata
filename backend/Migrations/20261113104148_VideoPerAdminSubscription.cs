using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace VayuVata.Migrations
{
    /// <inheritdoc />
    public partial class VideoPerAdminSubscription : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "SubscriptionStartsAt",
                table: "DeviceVideoConfiguration",
                type: "datetime2(3)",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "AdminVideoConfiguration",
                columns: table => new
                {
                    AdminUserId = table.Column<int>(type: "int", nullable: false),
                    SubscriptionStartsAt = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    SubscriptionExpiresAt = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    AdminControlEnabled = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    ForcedOff = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    AdminCanUpload = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    AdminCanDeleteOwn = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    UserCanView = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    UpdatedByUserId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AdminVideoConfiguration", x => x.AdminUserId);
                    table.ForeignKey(
                        name: "FK_AdminVideoConfiguration_Users_AdminUserId",
                        column: x => x.AdminUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AdminVideoConfiguration");

            migrationBuilder.DropColumn(
                name: "SubscriptionStartsAt",
                table: "DeviceVideoConfiguration");
        }
    }
}
