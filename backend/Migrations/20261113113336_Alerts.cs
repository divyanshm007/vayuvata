using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace VayuVata.Migrations
{
    /// <inheritdoc />
    public partial class Alerts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AlertConfiguration",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false),
                    FilterIntervalDays = table.Column<int>(type: "int", nullable: false),
                    BinIntervalDays = table.Column<int>(type: "int", nullable: false),
                    MaintenanceWarnDaysBefore = table.Column<int>(type: "int", nullable: false),
                    MaintenanceCriticalOverdueDays = table.Column<int>(type: "int", nullable: false),
                    MaintenanceRepeatDays = table.Column<int>(type: "int", nullable: false),
                    BaselineDays = table.Column<int>(type: "int", nullable: false),
                    RecentWindowMinutes = table.Column<int>(type: "int", nullable: false),
                    AqiChangePercent = table.Column<decimal>(type: "decimal(7,2)", precision: 7, scale: 2, nullable: false),
                    AqiMinChange = table.Column<decimal>(type: "decimal(7,2)", precision: 7, scale: 2, nullable: false),
                    TempChangeDegrees = table.Column<decimal>(type: "decimal(5,2)", precision: 5, scale: 2, nullable: false),
                    MinBaselineSamples = table.Column<int>(type: "int", nullable: false),
                    WarningAfterHours = table.Column<int>(type: "int", nullable: false),
                    CriticalAfterHours = table.Column<int>(type: "int", nullable: false),
                    ResolveGraceMinutes = table.Column<int>(type: "int", nullable: false),
                    OfflineAfterMinutes = table.Column<int>(type: "int", nullable: false),
                    OuterMissingPercent = table.Column<int>(type: "int", nullable: false),
                    EmailEnabled = table.Column<bool>(type: "bit", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    UpdatedByUserId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AlertConfiguration", x => x.Id);
                    table.CheckConstraint("CK_AlertConfiguration_single", "[Id] = 1");
                });

            migrationBuilder.CreateTable(
                name: "Alerts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    device_id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Category = table.Column<string>(type: "varchar(20)", unicode: false, maxLength: 20, nullable: false),
                    AlertType = table.Column<string>(type: "varchar(30)", unicode: false, maxLength: 30, nullable: false),
                    Status = table.Column<string>(type: "varchar(10)", unicode: false, maxLength: 10, nullable: false),
                    StartedAt = table.Column<DateTime>(type: "datetime2(3)", nullable: false),
                    WarningAt = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    CriticalAt = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    ResolvedAt = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    LastSeenAt = table.Column<DateTime>(type: "datetime2(3)", nullable: false),
                    LastNotifiedAt = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    Value = table.Column<decimal>(type: "decimal(10,2)", precision: 10, scale: 2, nullable: true),
                    Baseline = table.Column<decimal>(type: "decimal(10,2)", precision: 10, scale: 2, nullable: true),
                    Detail = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Alerts", x => x.Id);
                    table.CheckConstraint("CK_Alerts_Status", "[Status] IN ('Normal','Warning','Critical','Resolved')");
                    table.ForeignKey(
                        name: "FK_Alerts_Devices_device_id",
                        column: x => x.device_id,
                        principalTable: "Devices",
                        principalColumn: "DeviceId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DeviceMaintenance",
                columns: table => new
                {
                    device_id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    FilterChangedAt = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    BinCleanedAt = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    UpdatedByUserId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DeviceMaintenance", x => x.device_id);
                    table.ForeignKey(
                        name: "FK_DeviceMaintenance_Devices_device_id",
                        column: x => x.device_id,
                        principalTable: "Devices",
                        principalColumn: "DeviceId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "AlertEvents",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    AlertId = table.Column<int>(type: "int", nullable: false),
                    At = table.Column<DateTime>(type: "datetime2(3)", nullable: false),
                    device_id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Category = table.Column<string>(type: "varchar(20)", unicode: false, maxLength: 20, nullable: false),
                    AlertType = table.Column<string>(type: "varchar(30)", unicode: false, maxLength: 30, nullable: false),
                    Status = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    Detail = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AlertEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AlertEvents_Alerts_AlertId",
                        column: x => x.AlertId,
                        principalTable: "Alerts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AlertEvents_AlertId",
                table: "AlertEvents",
                column: "AlertId");

            migrationBuilder.CreateIndex(
                name: "IX_AlertEvents_at",
                table: "AlertEvents",
                column: "At");

            migrationBuilder.CreateIndex(
                name: "IX_AlertEvents_device",
                table: "AlertEvents",
                columns: new[] { "device_id", "At" });

            migrationBuilder.CreateIndex(
                name: "IX_Alerts_status",
                table: "Alerts",
                columns: new[] { "Status", "StartedAt" });

            migrationBuilder.CreateIndex(
                name: "UX_Alerts_open",
                table: "Alerts",
                columns: new[] { "device_id", "AlertType" },
                unique: true,
                filter: "[Status] <> 'Resolved'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AlertConfiguration");

            migrationBuilder.DropTable(
                name: "AlertEvents");

            migrationBuilder.DropTable(
                name: "DeviceMaintenance");

            migrationBuilder.DropTable(
                name: "Alerts");
        }
    }
}
