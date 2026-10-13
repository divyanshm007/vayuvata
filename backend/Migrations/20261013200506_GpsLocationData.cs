using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace VayuVata.Migrations
{
    /// <inheritdoc />
    public partial class GpsLocationData : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "GpsLocationData",
                columns: table => new
                {
                    ID = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    device_id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    recorded_at = table.Column<DateTime>(type: "datetime2(3)", nullable: false),
                    received_at = table.Column<DateTime>(type: "datetime2(3)", nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    has_fix = table.Column<bool>(type: "bit", nullable: false),
                    source = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: false),
                    latitude = table.Column<decimal>(type: "decimal(9,6)", precision: 9, scale: 6, nullable: true),
                    longitude = table.Column<decimal>(type: "decimal(9,6)", precision: 9, scale: 6, nullable: true),
                    altitude_m = table.Column<decimal>(type: "decimal(7,1)", precision: 7, scale: 1, nullable: true),
                    speed_kmh = table.Column<decimal>(type: "decimal(6,1)", precision: 6, scale: 1, nullable: true),
                    signal_pct = table.Column<byte>(type: "tinyint", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GpsLocationData", x => x.ID);
                    table.CheckConstraint("CK_GpsLocationData_fix", "([has_fix] = 1 AND [latitude] IS NOT NULL AND [longitude] IS NOT NULL) OR ([has_fix] = 0 AND [latitude] IS NULL AND [longitude] IS NULL)");
                    table.CheckConstraint("CK_GpsLocationData_ranges", "([latitude] IS NULL OR [latitude] BETWEEN -90 AND 90) AND ([longitude] IS NULL OR [longitude] BETWEEN -180 AND 180) AND ([signal_pct] IS NULL OR [signal_pct] BETWEEN 0 AND 100) AND ([speed_kmh] IS NULL OR [speed_kmh] >= 0)");
                    table.CheckConstraint("CK_GpsLocationData_source", "[source] IN ('gps','cell')");
                    table.ForeignKey(
                        name: "FK_GpsLocationData_Devices_device_id",
                        column: x => x.device_id,
                        principalTable: "Devices",
                        principalColumn: "DeviceId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "UX_GpsLocationData_device_recorded",
                table: "GpsLocationData",
                columns: new[] { "device_id", "recorded_at" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GpsLocationData");
        }
    }
}
