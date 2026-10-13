using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace VayuVata.Migrations
{
    /// <inheritdoc />
    public partial class SensorDataProcessing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ManipulatedSensorData",
                columns: table => new
                {
                    ManipulatedSensorDataID = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    SourceSensorDataID = table.Column<long>(type: "bigint", nullable: false),
                    ID = table.Column<long>(type: "bigint", nullable: false),
                    device_id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    data_date = table.Column<DateOnly>(type: "date", nullable: false),
                    data_time = table.Column<TimeOnly>(type: "time(3)", nullable: false),
                    recorded_at = table.Column<DateTime>(type: "datetime2(3)", nullable: false),
                    aqi = table.Column<int>(type: "int", nullable: true),
                    aqi_status = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    pm10 = table.Column<decimal>(type: "decimal(8,2)", precision: 8, scale: 2, nullable: true),
                    pm25 = table.Column<decimal>(type: "decimal(8,2)", precision: 8, scale: 2, nullable: true),
                    no2_ppm = table.Column<decimal>(type: "decimal(10,4)", precision: 10, scale: 4, nullable: true),
                    so2_ppm = table.Column<decimal>(type: "decimal(10,4)", precision: 10, scale: 4, nullable: true),
                    co_ppm = table.Column<decimal>(type: "decimal(10,4)", precision: 10, scale: 4, nullable: true),
                    tvoc_ppb = table.Column<decimal>(type: "decimal(10,2)", precision: 10, scale: 2, nullable: true),
                    humidity = table.Column<decimal>(type: "decimal(5,2)", precision: 5, scale: 2, nullable: true),
                    temperature = table.Column<decimal>(type: "decimal(6,2)", precision: 6, scale: 2, nullable: true),
                    outer_temperature = table.Column<decimal>(type: "decimal(6,2)", precision: 6, scale: 2, nullable: true),
                    outer_humidity = table.Column<decimal>(type: "decimal(5,2)", precision: 5, scale: 2, nullable: true),
                    created_at = table.Column<DateTime>(type: "datetime2(3)", nullable: false),
                    processed_at = table.Column<DateTime>(type: "datetime2(3)", nullable: false, defaultValueSql: "SYSUTCDATETIME()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ManipulatedSensorData", x => x.ManipulatedSensorDataID);
                    table.CheckConstraint("CK_ManipulatedSensorData_ID", "[ID] = [SourceSensorDataID]");
                    table.ForeignKey(
                        name: "FK_ManipulatedSensorData_SensorData_SourceSensorDataID",
                        column: x => x.SourceSensorDataID,
                        principalTable: "SensorData",
                        principalColumn: "ID",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ManipulatedSensorData_device_recorded",
                table: "ManipulatedSensorData",
                columns: new[] { "device_id", "recorded_at" });

            migrationBuilder.CreateIndex(
                name: "UX_ManipulatedSensorData_Source",
                table: "ManipulatedSensorData",
                column: "SourceSensorDataID",
                unique: true);

            // Table type, procedure and trigger come from the reviewed scripts in Database/Objects (embedded in the assembly).
            // Order matters: type -> procedure (uses the type and the table) -> trigger (calls the procedure).
            // Nothing is backfilled: only readings inserted AFTER this migration get a manipulated row.
            migrationBuilder.Sql(VayuVata.Data.SqlObjects.Read("01_SensorDataIdList.sql"));
            migrationBuilder.Sql(VayuVata.Data.SqlObjects.Read("02_ProcessSensorData.sql"));
            migrationBuilder.Sql(VayuVata.Data.SqlObjects.Read("03_TR_SensorData_AfterInsert.sql"));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TRIGGER IF EXISTS dbo.TR_SensorData_AfterInsert;");
            migrationBuilder.Sql("DROP PROCEDURE IF EXISTS dbo.ProcessSensorData;");
            migrationBuilder.Sql("DROP TYPE IF EXISTS dbo.SensorDataIdList;");
            migrationBuilder.DropTable(
                name: "ManipulatedSensorData");
        }
    }
}
