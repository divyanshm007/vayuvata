using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using VayuVata.Models;

namespace VayuVata.Data.Configurations;

public class VideoItemConfiguration : IEntityTypeConfiguration<VideoItem>
{
    public void Configure(EntityTypeBuilder<VideoItem> b)
    {
        b.ToTable("VideoLibrary");
        b.Property(v => v.DeviceCode).HasColumnName("device_id").IsRequired().HasMaxLength(64);
        b.Property(v => v.FileName).IsRequired().HasMaxLength(255);
        b.Property(v => v.StoredFileName).IsRequired().HasMaxLength(80).IsUnicode(false);
        b.Property(v => v.FilePath).IsRequired().HasMaxLength(200).IsUnicode(false);
        b.Property(v => v.ContentType).IsRequired().HasMaxLength(60).IsUnicode(false);
        b.Property(v => v.Sha256).IsRequired().HasMaxLength(64).IsUnicode(false);
        b.Property(v => v.ProcessingStatus).IsRequired().HasMaxLength(12).IsUnicode(false);
        b.Property(v => v.UploadedAt).HasColumnType("datetime2(3)").HasDefaultValueSql("SYSUTCDATETIME()");
        b.Property(v => v.DeletedAt).HasColumnType("datetime2(3)");
        b.HasOne(v => v.Device).WithMany().HasForeignKey(v => v.DeviceCode).HasPrincipalKey(d => d.DeviceId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(v => v.UploadedBy).WithMany().HasForeignKey(v => v.UploadedByUserId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(v => new { v.DeviceCode, v.UploadedAt }).HasDatabaseName("IX_VideoLibrary_device");
    }
}

public class DeviceVideoConfigurationConfiguration : IEntityTypeConfiguration<DeviceVideoConfiguration>
{
    public void Configure(EntityTypeBuilder<DeviceVideoConfiguration> b)
    {
        b.ToTable("DeviceVideoConfiguration");
        b.HasKey(c => c.DeviceCode);
        b.Property(c => c.DeviceCode).HasColumnName("device_id").HasMaxLength(64);
        b.Property(c => c.PlaybackEnabled).HasDefaultValue(false);
        b.Property(c => c.AdminControlEnabled).HasDefaultValue(false);
        b.Property(c => c.ForcedOff).HasDefaultValue(false);
        b.Property(c => c.SubscriptionStartsAt).HasColumnType("datetime2(3)");
        b.Property(c => c.SubscriptionExpiresAt).HasColumnType("datetime2(3)");
        b.Property(c => c.UpdatedAt).HasColumnType("datetime2(3)");
        b.HasOne(c => c.Device).WithMany().HasForeignKey(c => c.DeviceCode).HasPrincipalKey(d => d.DeviceId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(c => c.ActiveVideo).WithMany().HasForeignKey(c => c.ActiveVideoId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class AdminVideoConfigurationConfiguration : IEntityTypeConfiguration<AdminVideoConfiguration>
{
    public void Configure(EntityTypeBuilder<AdminVideoConfiguration> b)
    {
        b.ToTable("AdminVideoConfiguration");
        b.HasKey(c => c.AdminUserId);
        b.Property(c => c.AdminUserId).ValueGeneratedNever();
        b.Property(c => c.SubscriptionStartsAt).HasColumnType("datetime2(3)");
        b.Property(c => c.SubscriptionExpiresAt).HasColumnType("datetime2(3)");
        b.Property(c => c.AdminControlEnabled).HasDefaultValue(false);
        b.Property(c => c.ForcedOff).HasDefaultValue(false);
        b.Property(c => c.AdminCanUpload).HasDefaultValue(true);
        b.Property(c => c.AdminCanDeleteOwn).HasDefaultValue(true);
        b.Property(c => c.UserCanView).HasDefaultValue(false);
        b.Property(c => c.UpdatedAt).HasColumnType("datetime2(3)");
        b.HasOne(c => c.AdminUser).WithMany().HasForeignKey(c => c.AdminUserId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class VideoAccessPermissionConfiguration : IEntityTypeConfiguration<VideoAccessPermission>
{
    public void Configure(EntityTypeBuilder<VideoAccessPermission> b)
    {
        b.ToTable("VideoAccessPermission");
        b.HasKey(p => p.DeviceCode);
        b.Property(p => p.DeviceCode).HasColumnName("device_id").HasMaxLength(64);
        b.Property(p => p.AdminCanUpload).HasDefaultValue(true);
        b.Property(p => p.AdminCanDeleteOwn).HasDefaultValue(true);
        b.Property(p => p.UserCanView).HasDefaultValue(false);
        b.Property(p => p.UpdatedAt).HasColumnType("datetime2(3)");
        b.HasOne(p => p.Device).WithMany().HasForeignKey(p => p.DeviceCode).HasPrincipalKey(d => d.DeviceId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class VideoPlaybackStatusConfiguration : IEntityTypeConfiguration<VideoPlaybackStatus>
{
    public void Configure(EntityTypeBuilder<VideoPlaybackStatus> b)
    {
        b.ToTable("VideoPlaybackStatus");
        b.HasKey(s => s.DeviceCode);
        b.Property(s => s.DeviceCode).HasColumnName("device_id").HasMaxLength(64);
        b.Property(s => s.State).IsRequired().HasMaxLength(12).IsUnicode(false);
        b.Property(s => s.Message).HasMaxLength(300);
        b.Property(s => s.ReportedAt).HasColumnType("datetime2(3)");
        b.HasOne(s => s.Device).WithMany().HasForeignKey(s => s.DeviceCode).HasPrincipalKey(d => d.DeviceId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class VideoCommandHistoryConfiguration : IEntityTypeConfiguration<VideoCommandHistory>
{
    public void Configure(EntityTypeBuilder<VideoCommandHistory> b)
    {
        b.ToTable("VideoCommandHistory");
        b.Property(h => h.At).HasColumnType("datetime2(3)").HasDefaultValueSql("SYSUTCDATETIME()");
        b.Property(h => h.DeviceCode).HasColumnName("device_id").IsRequired().HasMaxLength(64);
        b.Property(h => h.Source).IsRequired().HasMaxLength(8).IsUnicode(false);
        b.Property(h => h.Action).IsRequired().HasMaxLength(20).IsUnicode(false);
        b.Property(h => h.Detail).HasMaxLength(300);
        b.HasOne(h => h.User).WithMany().HasForeignKey(h => h.UserId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(h => new { h.DeviceCode, h.At }).HasDatabaseName("IX_VideoCommandHistory_device");
    }
}
