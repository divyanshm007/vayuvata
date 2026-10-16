using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace VayuVata.Migrations
{
    /// <inheritdoc />
    public partial class GovernmentComparison : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "GovernmentStations",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    City = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    State = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Latitude = table.Column<decimal>(type: "decimal(9,6)", precision: 9, scale: 6, nullable: false),
                    Longitude = table.Column<decimal>(type: "decimal(9,6)", precision: 9, scale: 6, nullable: false),
                    LastSeenAt = table.Column<DateTime>(type: "datetime2(0)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GovernmentStations", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "GovernmentSyncLogs",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    StartedAt = table.Column<DateTime>(type: "datetime2(0)", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "datetime2(0)", nullable: true),
                    RecordsFetched = table.Column<int>(type: "int", nullable: false),
                    StationsAdded = table.Column<int>(type: "int", nullable: false),
                    ReadingsAdded = table.Column<int>(type: "int", nullable: false),
                    Status = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    Error = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    Trigger = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GovernmentSyncLogs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "DeviceStationMappings",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    device_id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    StationId = table.Column<int>(type: "int", nullable: false),
                    DistanceKm = table.Column<decimal>(type: "decimal(8,3)", precision: 8, scale: 3, nullable: false),
                    DeviceLatitude = table.Column<decimal>(type: "decimal(9,6)", precision: 9, scale: 6, nullable: false),
                    DeviceLongitude = table.Column<decimal>(type: "decimal(9,6)", precision: 9, scale: 6, nullable: false),
                    MatchedAt = table.Column<DateTime>(type: "datetime2(0)", nullable: false),
                    ValidTo = table.Column<DateTime>(type: "datetime2(0)", nullable: true),
                    Method = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DeviceStationMappings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DeviceStationMappings_Devices_device_id",
                        column: x => x.device_id,
                        principalTable: "Devices",
                        principalColumn: "DeviceId",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DeviceStationMappings_GovernmentStations_StationId",
                        column: x => x.StationId,
                        principalTable: "GovernmentStations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GovernmentStationReadings",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    StationId = table.Column<int>(type: "int", nullable: false),
                    Pollutant = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    ObservedAt = table.Column<DateTime>(type: "datetime2(0)", nullable: false),
                    MinValue = table.Column<decimal>(type: "decimal(10,2)", precision: 10, scale: 2, nullable: true),
                    MaxValue = table.Column<decimal>(type: "decimal(10,2)", precision: 10, scale: 2, nullable: true),
                    AvgValue = table.Column<decimal>(type: "decimal(10,2)", precision: 10, scale: 2, nullable: true),
                    FetchedAt = table.Column<DateTime>(type: "datetime2(0)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GovernmentStationReadings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GovernmentStationReadings_GovernmentStations_StationId",
                        column: x => x.StationId,
                        principalTable: "GovernmentStations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DeviceStationMappings_StationId",
                table: "DeviceStationMappings",
                column: "StationId");

            migrationBuilder.CreateIndex(
                name: "UX_DeviceStationMappings_current",
                table: "DeviceStationMappings",
                column: "device_id",
                unique: true,
                filter: "[ValidTo] IS NULL");

            migrationBuilder.CreateIndex(
                name: "UX_GovernmentStationReadings_identity",
                table: "GovernmentStationReadings",
                columns: new[] { "StationId", "Pollutant", "ObservedAt" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_GovernmentStations_identity",
                table: "GovernmentStations",
                columns: new[] { "Name", "Latitude", "Longitude" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DeviceStationMappings");

            migrationBuilder.DropTable(
                name: "GovernmentStationReadings");

            migrationBuilder.DropTable(
                name: "GovernmentSyncLogs");

            migrationBuilder.DropTable(
                name: "GovernmentStations");
        }
    }
}
