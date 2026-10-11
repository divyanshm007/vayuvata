using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using VayuVata.Models;

namespace VayuVata.Data.Configurations;

public class SensorDataConfiguration : IEntityTypeConfiguration<SensorData>
{
    public void Configure(EntityTypeBuilder<SensorData> b)
    {
        b.ToTable("SensorData");
        b.HasKey(s => s.Id);
        b.Property(s => s.Id).HasColumnName("ID").UseIdentityColumn();
        b.Property(s => s.DeviceCode).HasColumnName("device_id").IsRequired().HasMaxLength(64);
        b.Property(s => s.DataDate).HasColumnName("data_date").HasColumnType("date");
        b.Property(s => s.DataTime).HasColumnName("data_time").HasColumnType("time(3)");
        b.Property(s => s.RecordedAt).HasColumnName("recorded_at").HasColumnType("datetime2(3)");
        b.Property(s => s.Aqi).HasColumnName("aqi");
        b.Property(s => s.AqiStatus).HasColumnName("aqi_status").HasMaxLength(32);
        b.Property(s => s.Pm10).HasColumnName("pm10").HasPrecision(8, 2);
        b.Property(s => s.Pm25).HasColumnName("pm25").HasPrecision(8, 2);
        b.Property(s => s.No2Ppm).HasColumnName("no2_ppm").HasPrecision(10, 4);
        b.Property(s => s.So2Ppm).HasColumnName("so2_ppm").HasPrecision(10, 4);
        b.Property(s => s.CoPpm).HasColumnName("co_ppm").HasPrecision(10, 4);
        b.Property(s => s.TvocPpb).HasColumnName("tvoc_ppb").HasPrecision(10, 2);
        b.Property(s => s.Humidity).HasColumnName("humidity").HasPrecision(5, 2);
        b.Property(s => s.Temperature).HasColumnName("temperature").HasPrecision(6, 2);
        b.Property(s => s.OuterTemperature).HasColumnName("outer_temperature").HasPrecision(6, 2);
        b.Property(s => s.OuterHumidity).HasColumnName("outer_humidity").HasPrecision(5, 2);
        b.Property(s => s.CreatedAt).HasColumnName("created_at").HasColumnType("datetime2(3)")
            .HasDefaultValueSql("SYSUTCDATETIME()").ValueGeneratedOnAdd();

        // device_id references the physical identifier Devices.DeviceId (unique), not Devices.Id.
        b.HasOne(s => s.Device).WithMany().HasForeignKey(s => s.DeviceCode)
            .HasPrincipalKey(d => d.DeviceId).OnDelete(DeleteBehavior.Restrict);

        b.HasIndex(s => s.DeviceCode).HasDatabaseName("IX_SensorData_device_id");
        b.HasIndex(s => s.RecordedAt).HasDatabaseName("IX_SensorData_recorded_at");
        // Stable reading identity = (device, recorded_at): duplicate submissions are rejected.
        b.HasIndex(s => new { s.DeviceCode, s.RecordedAt }).IsUnique().HasDatabaseName("UX_SensorData_device_recorded");
    }
}

public class RefreshTokenConfiguration : IEntityTypeConfiguration<RefreshToken>
{
    public void Configure(EntityTypeBuilder<RefreshToken> b)
    {
        b.ToTable("RefreshTokens");
        b.HasKey(r => r.Id);
        b.Property(r => r.TokenHash).IsRequired().HasMaxLength(64).IsFixedLength();
        b.Property(r => r.CreatedAt).HasColumnType("datetime2(3)");
        b.Property(r => r.ExpiresAt).HasColumnType("datetime2(3)");
        b.Property(r => r.RevokedAt).HasColumnType("datetime2(3)");
        b.HasIndex(r => r.TokenHash).IsUnique();
        b.HasOne(r => r.User).WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Restrict);
    }
}
