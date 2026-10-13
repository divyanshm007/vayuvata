using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using VayuVata.Models;

namespace VayuVata.Data.Configurations;

public class DeviceConfiguration : IEntityTypeConfiguration<Device>
{
    public void Configure(EntityTypeBuilder<Device> b)
    {
        b.ToTable("Devices");
        b.HasKey(d => d.Id);
        b.Property(d => d.DeviceId).IsRequired().HasMaxLength(64);
        b.Property(d => d.DeviceName).IsRequired().HasMaxLength(150);
        b.Property(d => d.Description).HasMaxLength(500);
        b.Property(d => d.ApiKeyHash).HasMaxLength(64).IsFixedLength();
        b.Property(d => d.IsActive).HasDefaultValue(true);
        b.Property(d => d.CreatedAt).HasColumnType("datetime2(3)").HasDefaultValueSql("SYSUTCDATETIME()");
        b.Property(d => d.UpdatedAt).HasColumnType("datetime2(3)");
        // Uniqueness of DeviceId is enforced by the alternate key AK_Devices_DeviceId (also the target of the SensorData FK);
        // a second unique index on the same column was redundant and has been dropped.
    }
}

public class DeviceAssignmentConfiguration : IEntityTypeConfiguration<DeviceAssignment>
{
    public void Configure(EntityTypeBuilder<DeviceAssignment> b)
    {
        b.ToTable("DeviceAssignments");
        b.HasKey(a => a.Id);
        b.Property(a => a.AssignedAt).HasColumnType("datetime2(3)").HasDefaultValueSql("SYSUTCDATETIME()");
        b.Property(a => a.UnassignedAt).HasColumnType("datetime2(3)");
        b.Property(a => a.Notes).HasMaxLength(500);

        b.HasOne(a => a.Device).WithMany(d => d.Assignments).HasForeignKey(a => a.DeviceRecordId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(a => a.User).WithMany(u => u.Assignments).HasForeignKey(a => a.UserId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(a => a.AssignedBy).WithMany().HasForeignKey(a => a.AssignedByUserId).OnDelete(DeleteBehavior.Restrict);

        // A device can have at most one active assignment at any time.
        b.HasIndex(a => a.DeviceRecordId).IsUnique().HasFilter("[IsActive] = 1").HasDatabaseName("UX_DeviceAssignments_ActiveDevice");
        b.HasIndex(a => new { a.UserId, a.IsActive });
    }
}
