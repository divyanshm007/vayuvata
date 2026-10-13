using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using VayuVata.Models;

namespace VayuVata.Data.Configurations;

public class GpsLocationDataConfiguration : IEntityTypeConfiguration<GpsLocationData>
{
    public void Configure(EntityTypeBuilder<GpsLocationData> b)
    {
        b.ToTable("GpsLocationData", t =>
        {
            t.HasCheckConstraint("CK_GpsLocationData_source", "[source] IN ('gps','cell')");
            // A fix has a position; a "no fix" report has none (NULL, never 0).
            t.HasCheckConstraint("CK_GpsLocationData_fix",
                "([has_fix] = 1 AND [latitude] IS NOT NULL AND [longitude] IS NOT NULL) OR ([has_fix] = 0 AND [latitude] IS NULL AND [longitude] IS NULL)");
            t.HasCheckConstraint("CK_GpsLocationData_ranges",
                "([latitude] IS NULL OR [latitude] BETWEEN -90 AND 90) AND ([longitude] IS NULL OR [longitude] BETWEEN -180 AND 180) AND ([signal_pct] IS NULL OR [signal_pct] BETWEEN 0 AND 100) AND ([speed_kmh] IS NULL OR [speed_kmh] >= 0)");
        });
        b.HasKey(g => g.Id);
        b.Property(g => g.Id).HasColumnName("ID").UseIdentityColumn();
        b.Property(g => g.DeviceCode).HasColumnName("device_id").IsRequired().HasMaxLength(64);
        b.Property(g => g.RecordedAt).HasColumnName("recorded_at").HasColumnType("datetime2(3)");
        b.Property(g => g.ReceivedAt).HasColumnName("received_at").HasColumnType("datetime2(3)")
            .HasDefaultValueSql("DATEADD(MINUTE, 330, SYSUTCDATETIME())").ValueGeneratedOnAdd();   // IST wall-clock
        b.Property(g => g.HasFix).HasColumnName("has_fix");
        b.Property(g => g.Source).HasColumnName("source").IsRequired().HasMaxLength(8);
        b.Property(g => g.Latitude).HasColumnName("latitude").HasPrecision(9, 6);
        b.Property(g => g.Longitude).HasColumnName("longitude").HasPrecision(9, 6);
        b.Property(g => g.AltitudeM).HasColumnName("altitude_m").HasPrecision(7, 1);
        b.Property(g => g.SpeedKmh).HasColumnName("speed_kmh").HasPrecision(6, 1);
        b.Property(g => g.SignalPct).HasColumnName("signal_pct");

        b.HasOne(g => g.Device).WithMany().HasForeignKey(g => g.DeviceCode)
            .HasPrincipalKey(d => d.DeviceId).OnDelete(DeleteBehavior.Restrict);
        // Stable report identity = (device, recorded_at): makes an upload retry idempotent; also serves "latest per device" (reverse scan).
        b.HasIndex(g => new { g.DeviceCode, g.RecordedAt }).IsUnique().HasDatabaseName("UX_GpsLocationData_device_recorded");
    }
}
