using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace VayuVata.Migrations
{
    /// <inheritdoc />
    public partial class GpsLocationIst : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<DateTime>(
                name: "received_at",
                table: "GpsLocationData",
                type: "datetime2(3)",
                nullable: false,
                defaultValueSql: "DATEADD(MINUTE, 330, SYSUTCDATETIME())",
                oldClrType: typeof(DateTime),
                oldType: "datetime2(3)",
                oldDefaultValueSql: "SYSUTCDATETIME()");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<DateTime>(
                name: "received_at",
                table: "GpsLocationData",
                type: "datetime2(3)",
                nullable: false,
                defaultValueSql: "SYSUTCDATETIME()",
                oldClrType: typeof(DateTime),
                oldType: "datetime2(3)",
                oldDefaultValueSql: "DATEADD(MINUTE, 330, SYSUTCDATETIME())");
        }
    }
}
