using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace VayuVata.Migrations
{
    /// <inheritdoc />
    public partial class ShellyDeviceConfiguration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ConfigUpdatedAt",
                table: "ShellyDevices",
                type: "datetime2(3)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ConfigUpdatedByUserId",
                table: "ShellyDevices",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<TimeOnly>(
                name: "DailyOffTime",
                table: "ShellyDevices",
                type: "time(0)",
                nullable: true);

            migrationBuilder.AddColumn<TimeOnly>(
                name: "DailyOnTime",
                table: "ShellyDevices",
                type: "time(0)",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "LastScheduleOffDate",
                table: "ShellyDevices",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "LastScheduleOnDate",
                table: "ShellyDevices",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "OverrideActive",
                table: "ShellyDevices",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "OverrideSetAt",
                table: "ShellyDevices",
                type: "datetime2(3)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "OverrideSetByUserId",
                table: "ShellyDevices",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ScheduleEnabled",
                table: "ShellyDevices",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AlterColumn<int>(
                name: "UserId",
                table: "ShellyCommands",
                type: "int",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "int");

            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "ShellyCommands",
                type: "varchar(12)",
                unicode: false,
                maxLength: 12,
                nullable: false,
                defaultValue: "Manual");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ConfigUpdatedAt",
                table: "ShellyDevices");

            migrationBuilder.DropColumn(
                name: "ConfigUpdatedByUserId",
                table: "ShellyDevices");

            migrationBuilder.DropColumn(
                name: "DailyOffTime",
                table: "ShellyDevices");

            migrationBuilder.DropColumn(
                name: "DailyOnTime",
                table: "ShellyDevices");

            migrationBuilder.DropColumn(
                name: "LastScheduleOffDate",
                table: "ShellyDevices");

            migrationBuilder.DropColumn(
                name: "LastScheduleOnDate",
                table: "ShellyDevices");

            migrationBuilder.DropColumn(
                name: "OverrideActive",
                table: "ShellyDevices");

            migrationBuilder.DropColumn(
                name: "OverrideSetAt",
                table: "ShellyDevices");

            migrationBuilder.DropColumn(
                name: "OverrideSetByUserId",
                table: "ShellyDevices");

            migrationBuilder.DropColumn(
                name: "ScheduleEnabled",
                table: "ShellyDevices");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "ShellyCommands");

            migrationBuilder.AlterColumn<int>(
                name: "UserId",
                table: "ShellyCommands",
                type: "int",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "int",
                oldNullable: true);
        }
    }
}
