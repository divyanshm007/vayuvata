using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using VayuVata.Models;

namespace VayuVata.Data.Configurations;

public class AlertConfigurationConfiguration : IEntityTypeConfiguration<AlertConfiguration>
{
    public void Configure(EntityTypeBuilder<AlertConfiguration> b)
    {
        b.ToTable("AlertConfiguration", t => t.HasCheckConstraint("CK_AlertConfiguration_single", "[Id] = 1"));
        b.HasKey(c => c.Id);
        b.Property(c => c.Id).ValueGeneratedNever();
        b.Property(c => c.AqiChangePercent).HasPrecision(7, 2);
        b.Property(c => c.AqiMinChange).HasPrecision(7, 2);
        b.Property(c => c.TempChangeDegrees).HasPrecision(5, 2);
        b.Property(c => c.UpdatedAt).HasColumnType("datetime2(3)");
    }
}

public class DeviceMaintenanceConfiguration : IEntityTypeConfiguration<DeviceMaintenance>
{
    public void Configure(EntityTypeBuilder<DeviceMaintenance> b)
    {
        b.ToTable("DeviceMaintenance");
        b.HasKey(m => m.DeviceCode);
        b.Property(m => m.DeviceCode).HasColumnName("device_id").HasMaxLength(64);
        b.Property(m => m.FilterChangedAt).HasColumnType("datetime2(3)");
        b.Property(m => m.BinCleanedAt).HasColumnType("datetime2(3)");
        b.Property(m => m.UpdatedAt).HasColumnType("datetime2(3)");
        b.HasOne(m => m.Device).WithMany().HasForeignKey(m => m.DeviceCode).HasPrincipalKey(d => d.DeviceId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class AlertEntityConfiguration : IEntityTypeConfiguration<Alert>
{
    public void Configure(EntityTypeBuilder<Alert> b)
    {
        b.ToTable("Alerts", t => t.HasCheckConstraint("CK_Alerts_Status", "[Status] IN ('Normal','Warning','Critical','Resolved')"));
        b.Property(a => a.DeviceCode).HasColumnName("device_id").IsRequired().HasMaxLength(64);
        b.Property(a => a.Category).IsRequired().HasMaxLength(20).IsUnicode(false);
        b.Property(a => a.AlertType).IsRequired().HasMaxLength(30).IsUnicode(false);
        b.Property(a => a.Status).IsRequired().HasMaxLength(10).IsUnicode(false);
        b.Property(a => a.StartedAt).HasColumnType("datetime2(3)");
        b.Property(a => a.WarningAt).HasColumnType("datetime2(3)");
        b.Property(a => a.CriticalAt).HasColumnType("datetime2(3)");
        b.Property(a => a.ResolvedAt).HasColumnType("datetime2(3)");
        b.Property(a => a.LastSeenAt).HasColumnType("datetime2(3)");
        b.Property(a => a.LastNotifiedAt).HasColumnType("datetime2(3)");
        b.Property(a => a.Value).HasPrecision(10, 2);
        b.Property(a => a.Baseline).HasPrecision(10, 2);
        b.Property(a => a.Detail).HasMaxLength(300);
        b.HasOne(a => a.Device).WithMany().HasForeignKey(a => a.DeviceCode).HasPrincipalKey(d => d.DeviceId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(a => new { a.DeviceCode, a.AlertType }).IsUnique().HasFilter("[Status] <> 'Resolved'").HasDatabaseName("UX_Alerts_open");
        b.HasIndex(a => new { a.Status, a.StartedAt }).HasDatabaseName("IX_Alerts_status");
    }
}

public class AlertEventConfiguration : IEntityTypeConfiguration<AlertEvent>
{
    public void Configure(EntityTypeBuilder<AlertEvent> b)
    {
        b.ToTable("AlertEvents");
        b.Property(e => e.At).HasColumnType("datetime2(3)");
        b.Property(e => e.DeviceCode).HasColumnName("device_id").IsRequired().HasMaxLength(64);
        b.Property(e => e.Category).IsRequired().HasMaxLength(20).IsUnicode(false);
        b.Property(e => e.AlertType).IsRequired().HasMaxLength(30).IsUnicode(false);
        b.Property(e => e.Status).IsRequired().HasMaxLength(12).IsUnicode(false);
        b.Property(e => e.Detail).HasMaxLength(300);
        b.HasOne(e => e.Alert).WithMany().HasForeignKey(e => e.AlertId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(e => new { e.DeviceCode, e.At }).HasDatabaseName("IX_AlertEvents_device");
        b.HasIndex(e => e.At).HasDatabaseName("IX_AlertEvents_at");
    }
}
