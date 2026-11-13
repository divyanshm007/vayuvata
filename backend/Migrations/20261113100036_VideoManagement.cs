using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace VayuVata.Migrations
{
    /// <inheritdoc />
    public partial class VideoManagement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "VideoAccessPermission",
                columns: table => new
                {
                    device_id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    AdminCanUpload = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    AdminCanDeleteOwn = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    UserCanView = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    UpdatedByUserId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VideoAccessPermission", x => x.device_id);
                    table.ForeignKey(
                        name: "FK_VideoAccessPermission_Devices_device_id",
                        column: x => x.device_id,
                        principalTable: "Devices",
                        principalColumn: "DeviceId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "VideoCommandHistory",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    At = table.Column<DateTime>(type: "datetime2(3)", nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    device_id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    VideoId = table.Column<int>(type: "int", nullable: true),
                    UserId = table.Column<int>(type: "int", nullable: true),
                    Source = table.Column<string>(type: "varchar(8)", unicode: false, maxLength: 8, nullable: false),
                    Action = table.Column<string>(type: "varchar(20)", unicode: false, maxLength: 20, nullable: false),
                    Success = table.Column<bool>(type: "bit", nullable: false),
                    Detail = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VideoCommandHistory", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VideoCommandHistory_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "VideoLibrary",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    device_id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    FileName = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    StoredFileName = table.Column<string>(type: "varchar(80)", unicode: false, maxLength: 80, nullable: false),
                    FilePath = table.Column<string>(type: "varchar(200)", unicode: false, maxLength: 200, nullable: false),
                    ContentType = table.Column<string>(type: "varchar(60)", unicode: false, maxLength: 60, nullable: false),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    Sha256 = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    UploadedByUserId = table.Column<int>(type: "int", nullable: false),
                    UploadedAt = table.Column<DateTime>(type: "datetime2(3)", nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    ProcessingStatus = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    DeletedByUserId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VideoLibrary", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VideoLibrary_Devices_device_id",
                        column: x => x.device_id,
                        principalTable: "Devices",
                        principalColumn: "DeviceId",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_VideoLibrary_Users_UploadedByUserId",
                        column: x => x.UploadedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "VideoPlaybackStatus",
                columns: table => new
                {
                    device_id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    VideoId = table.Column<int>(type: "int", nullable: true),
                    State = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    Message = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    ReportedAt = table.Column<DateTime>(type: "datetime2(3)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VideoPlaybackStatus", x => x.device_id);
                    table.ForeignKey(
                        name: "FK_VideoPlaybackStatus_Devices_device_id",
                        column: x => x.device_id,
                        principalTable: "Devices",
                        principalColumn: "DeviceId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DeviceVideoConfiguration",
                columns: table => new
                {
                    device_id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    PlaybackEnabled = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    AdminControlEnabled = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    ForcedOff = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    SubscriptionExpiresAt = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    ActiveVideoId = table.Column<int>(type: "int", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    UpdatedByUserId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DeviceVideoConfiguration", x => x.device_id);
                    table.ForeignKey(
                        name: "FK_DeviceVideoConfiguration_Devices_device_id",
                        column: x => x.device_id,
                        principalTable: "Devices",
                        principalColumn: "DeviceId",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DeviceVideoConfiguration_VideoLibrary_ActiveVideoId",
                        column: x => x.ActiveVideoId,
                        principalTable: "VideoLibrary",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DeviceVideoConfiguration_ActiveVideoId",
                table: "DeviceVideoConfiguration",
                column: "ActiveVideoId");

            migrationBuilder.CreateIndex(
                name: "IX_VideoCommandHistory_device",
                table: "VideoCommandHistory",
                columns: new[] { "device_id", "At" });

            migrationBuilder.CreateIndex(
                name: "IX_VideoCommandHistory_UserId",
                table: "VideoCommandHistory",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_VideoLibrary_device",
                table: "VideoLibrary",
                columns: new[] { "device_id", "UploadedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_VideoLibrary_UploadedByUserId",
                table: "VideoLibrary",
                column: "UploadedByUserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DeviceVideoConfiguration");

            migrationBuilder.DropTable(
                name: "VideoAccessPermission");

            migrationBuilder.DropTable(
                name: "VideoCommandHistory");

            migrationBuilder.DropTable(
                name: "VideoPlaybackStatus");

            migrationBuilder.DropTable(
                name: "VideoLibrary");
        }
    }
}
