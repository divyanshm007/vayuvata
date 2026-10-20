using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace VayuVata.Migrations
{
    /// <inheritdoc />
    public partial class ShellyDevices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ShellyDevices",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    ShellyId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    AuthKey = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    CloudHost = table.Column<string>(type: "varchar(100)", unicode: false, maxLength: 100, nullable: false),
                    Channel = table.Column<byte>(type: "tinyint", nullable: false),
                    device_id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2(3)", nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2(3)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ShellyDevices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ShellyDevices_Devices_device_id",
                        column: x => x.device_id,
                        principalTable: "Devices",
                        principalColumn: "DeviceId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ShellyCommands",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ShellyDeviceId = table.Column<int>(type: "int", nullable: false),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    TurnOn = table.Column<bool>(type: "bit", nullable: false),
                    Succeeded = table.Column<bool>(type: "bit", nullable: false),
                    Error = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    At = table.Column<DateTime>(type: "datetime2(3)", nullable: false, defaultValueSql: "SYSUTCDATETIME()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ShellyCommands", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ShellyCommands_ShellyDevices_ShellyDeviceId",
                        column: x => x.ShellyDeviceId,
                        principalTable: "ShellyDevices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ShellyCommands_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ShellyCommands_device_at",
                table: "ShellyCommands",
                columns: new[] { "ShellyDeviceId", "At" });

            migrationBuilder.CreateIndex(
                name: "IX_ShellyCommands_UserId",
                table: "ShellyCommands",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "UX_ShellyDevices_device",
                table: "ShellyDevices",
                column: "device_id",
                unique: true,
                filter: "[device_id] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "UX_ShellyDevices_ShellyId",
                table: "ShellyDevices",
                column: "ShellyId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ShellyCommands");

            migrationBuilder.DropTable(
                name: "ShellyDevices");
        }
    }
}
