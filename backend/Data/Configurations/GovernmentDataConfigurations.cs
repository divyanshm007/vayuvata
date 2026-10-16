using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using VayuVata.Models;

namespace VayuVata.Data.Configurations;

public class GovernmentStationConfiguration : IEntityTypeConfiguration<GovernmentStation>
{
    public void Configure(EntityTypeBuilder<GovernmentStation> b)
    {
        b.ToTable("GovernmentStations");
        b.Property(s => s.Name).IsRequired().HasMaxLength(200);
        b.Property(s => s.City).IsRequired().HasMaxLength(100);
        b.Property(s => s.State).IsRequired().HasMaxLength(100);
        b.Property(s => s.Latitude).HasPrecision(9, 6);
        b.Property(s => s.Longitude).HasPrecision(9, 6);
        b.Property(s => s.LastSeenAt).HasColumnType("datetime2(0)");
        b.HasIndex(s => new { s.Name, s.Latitude, s.Longitude }).IsUnique().HasDatabaseName("UX_GovernmentStations_identity");
    }
}

public class GovernmentStationReadingConfiguration : IEntityTypeConfiguration<GovernmentStationReading>
{
    public void Configure(EntityTypeBuilder<GovernmentStationReading> b)
    {
        b.ToTable("GovernmentStationReadings");
        b.Property(r => r.Pollutant).IsRequired().HasMaxLength(16).IsUnicode(false);
        b.Property(r => r.ObservedAt).HasColumnType("datetime2(0)");
        b.Property(r => r.MinValue).HasPrecision(10, 2);
        b.Property(r => r.MaxValue).HasPrecision(10, 2);
        b.Property(r => r.AvgValue).HasPrecision(10, 2);
        b.Property(r => r.FetchedAt).HasColumnType("datetime2(0)");
        b.HasOne(r => r.Station).WithMany(s => s.Readings).HasForeignKey(r => r.StationId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(r => new { r.StationId, r.Pollutant, r.ObservedAt }).IsUnique().HasDatabaseName("UX_GovernmentStationReadings_identity");
    }
}

public class DeviceStationMappingConfiguration : IEntityTypeConfiguration<DeviceStationMapping>
{
    public void Configure(EntityTypeBuilder<DeviceStationMapping> b)
    {
        b.ToTable("DeviceStationMappings");
        b.Property(m => m.DeviceCode).HasColumnName("device_id").IsRequired().HasMaxLength(64);
        b.Property(m => m.DistanceKm).HasPrecision(8, 3);
        b.Property(m => m.DeviceLatitude).HasPrecision(9, 6);
        b.Property(m => m.DeviceLongitude).HasPrecision(9, 6);
        b.Property(m => m.MatchedAt).HasColumnType("datetime2(0)");
        b.Property(m => m.ValidTo).HasColumnType("datetime2(0)");
        b.Property(m => m.Method).IsRequired().HasMaxLength(16).IsUnicode(false);
        b.HasOne(m => m.Device).WithMany().HasForeignKey(m => m.DeviceCode).HasPrincipalKey(d => d.DeviceId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(m => m.Station).WithMany().HasForeignKey(m => m.StationId).OnDelete(DeleteBehavior.Restrict);
        // One current mapping per device; closed ones are history.
        b.HasIndex(m => m.DeviceCode).IsUnique().HasFilter("[ValidTo] IS NULL").HasDatabaseName("UX_DeviceStationMappings_current");
    }
}

public class GovernmentSyncLogConfiguration : IEntityTypeConfiguration<GovernmentSyncLog>
{
    public void Configure(EntityTypeBuilder<GovernmentSyncLog> b)
    {
        b.ToTable("GovernmentSyncLogs");
        b.Property(l => l.StartedAt).HasColumnType("datetime2(0)");
        b.Property(l => l.CompletedAt).HasColumnType("datetime2(0)");
        b.Property(l => l.Status).IsRequired().HasMaxLength(16).IsUnicode(false);
        b.Property(l => l.Error).HasMaxLength(500);
        b.Property(l => l.Trigger).IsRequired().HasMaxLength(16).IsUnicode(false);
    }
}
