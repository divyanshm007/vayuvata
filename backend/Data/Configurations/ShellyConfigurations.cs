using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using VayuVata.Models;

namespace VayuVata.Data.Configurations;

public class ShellyDeviceConfiguration : IEntityTypeConfiguration<ShellyDevice>
{
    public void Configure(EntityTypeBuilder<ShellyDevice> b)
    {
        b.ToTable("ShellyDevices");
        b.Property(s => s.Name).IsRequired().HasMaxLength(150);
        b.Property(s => s.ShellyId).IsRequired().HasMaxLength(32).IsUnicode(false);
        b.Property(s => s.AuthKey).IsRequired().HasMaxLength(300);
        b.Property(s => s.CloudHost).IsRequired().HasMaxLength(100).IsUnicode(false);
        b.Property(s => s.DeviceCode).HasColumnName("device_id").HasMaxLength(64);
        b.Property(s => s.IsActive).HasDefaultValue(true);
        b.Property(s => s.CreatedAt).HasColumnType("datetime2(3)").HasDefaultValueSql("SYSUTCDATETIME()");
        b.Property(s => s.UpdatedAt).HasColumnType("datetime2(3)");
        b.Property(s => s.ScheduleEnabled).HasDefaultValue(false);
        b.Property(s => s.DailyOnTime).HasColumnType("time(0)");
        b.Property(s => s.DailyOffTime).HasColumnType("time(0)");
        b.Property(s => s.OverrideActive).HasDefaultValue(false);
        b.Property(s => s.OverrideSetAt).HasColumnType("datetime2(3)");
        b.Property(s => s.LastScheduleOnDate).HasColumnType("date");
        b.Property(s => s.LastScheduleOffDate).HasColumnType("date");
        b.Property(s => s.ConfigUpdatedAt).HasColumnType("datetime2(3)");
        b.HasOne(s => s.Device).WithMany().HasForeignKey(s => s.DeviceCode).HasPrincipalKey(d => d.DeviceId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(s => s.ShellyId).IsUnique().HasDatabaseName("UX_ShellyDevices_ShellyId");
        // One switch per VayuVata device; unlinked switches (NULL) are unlimited.
        b.HasIndex(s => s.DeviceCode).IsUnique().HasFilter("[device_id] IS NOT NULL").HasDatabaseName("UX_ShellyDevices_device");
    }
}

public class ShellyCommandConfiguration : IEntityTypeConfiguration<ShellyCommand>
{
    public void Configure(EntityTypeBuilder<ShellyCommand> b)
    {
        b.ToTable("ShellyCommands");
        b.Property(c => c.Error).HasMaxLength(300);
        b.Property(c => c.Source).IsRequired().HasMaxLength(12).IsUnicode(false).HasDefaultValue("Manual");
        b.Property(c => c.At).HasColumnType("datetime2(3)").HasDefaultValueSql("SYSUTCDATETIME()");
        b.HasOne(c => c.ShellyDevice).WithMany(s => s.Commands).HasForeignKey(c => c.ShellyDeviceId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(c => c.User).WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(c => new { c.ShellyDeviceId, c.At }).HasDatabaseName("IX_ShellyCommands_device_at");
    }
}
