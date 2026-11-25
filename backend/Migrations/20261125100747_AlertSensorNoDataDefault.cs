using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace VayuVata.Migrations
{
    /// <inheritdoc />
    public partial class AlertSensorNoDataDefault : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("UPDATE dbo.AlertConfiguration SET SensorNoDataMinutes = 5 WHERE SensorNoDataMinutes < 1");   // the first migration added the column with 0
            migrationBuilder.AlterColumn<int>(
                name: "SensorNoDataMinutes",
                table: "AlertConfiguration",
                type: "int",
                nullable: false,
                defaultValue: 5,
                oldClrType: typeof(int),
                oldType: "int");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<int>(
                name: "SensorNoDataMinutes",
                table: "AlertConfiguration",
                type: "int",
                nullable: false,
                oldClrType: typeof(int),
                oldType: "int",
                oldDefaultValue: 5);
        }
    }
}
