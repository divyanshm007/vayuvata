using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using VayuVata.Models;

namespace VayuVata.Data;

public class VayuVataDbContext(DbContextOptions<VayuVataDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Device> Devices => Set<Device>();
    public DbSet<DeviceAssignment> DeviceAssignments => Set<DeviceAssignment>();
    public DbSet<SensorData> SensorData => Set<SensorData>();
    public DbSet<ManipulatedSensorData> ManipulatedSensorData => Set<ManipulatedSensorData>();
    public DbSet<GpsLocationData> GpsLocationData => Set<GpsLocationData>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<GovernmentStation> GovernmentStations => Set<GovernmentStation>();
    public DbSet<GovernmentStationReading> GovernmentStationReadings => Set<GovernmentStationReading>();
    public DbSet<DeviceStationMapping> DeviceStationMappings => Set<DeviceStationMapping>();
    public DbSet<GovernmentSyncLog> GovernmentSyncLogs => Set<GovernmentSyncLog>();
    public DbSet<ShellyDevice> ShellyDevices => Set<ShellyDevice>();
    public DbSet<ShellyCommand> ShellyCommands => Set<ShellyCommand>();
    public DbSet<LocationName> LocationNames => Set<LocationName>();
    public DbSet<RegistrationRequest> RegistrationRequests => Set<RegistrationRequest>();
    public DbSet<AccountInvitation> AccountInvitations => Set<AccountInvitation>();
    public DbSet<AccountHistory> AccountHistory => Set<AccountHistory>();
    public DbSet<EmailLog> EmailLogs => Set<EmailLog>();
    public DbSet<VideoItem> VideoItems => Set<VideoItem>();
    public DbSet<DeviceVideoConfiguration> DeviceVideoConfigurations => Set<DeviceVideoConfiguration>();
    public DbSet<VideoAccessPermission> VideoAccessPermissions => Set<VideoAccessPermission>();
    public DbSet<AdminVideoConfiguration> AdminVideoConfigurations => Set<AdminVideoConfiguration>();
    public DbSet<VideoPlaybackStatus> VideoPlaybackStatuses => Set<VideoPlaybackStatus>();
    public DbSet<VideoCommandHistory> VideoCommandHistories => Set<VideoCommandHistory>();
    public DbSet<AlertConfiguration> AlertConfigurations => Set<AlertConfiguration>();
    public DbSet<DeviceMaintenance> DeviceMaintenances => Set<DeviceMaintenance>();
    public DbSet<Alert> Alerts => Set<Alert>();
    public DbSet<AlertEvent> AlertEvents => Set<AlertEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
        => modelBuilder.ApplyConfigurationsFromAssembly(typeof(VayuVataDbContext).Assembly);

    // All timestamps are stored as UTC. SQL Server returns datetime2 as Kind=Unspecified, which
    // would serialize without a "Z" and be misread as local time, so mark every value as UTC on read.
    protected override void ConfigureConventions(ModelConfigurationBuilder builder)
    {
        builder.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>();
        builder.Properties<DateTime?>().HaveConversion<NullableUtcDateTimeConverter>();
    }

    private sealed class UtcDateTimeConverter() : ValueConverter<DateTime, DateTime>(
        v => v.Kind == DateTimeKind.Local ? v.ToUniversalTime() : v,
        v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

    private sealed class NullableUtcDateTimeConverter() : ValueConverter<DateTime?, DateTime?>(
        v => v.HasValue && v.Value.Kind == DateTimeKind.Local ? v.Value.ToUniversalTime() : v,
        v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v);
}
