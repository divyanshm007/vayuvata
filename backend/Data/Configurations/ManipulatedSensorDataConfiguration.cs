using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using VayuVata.Models;

namespace VayuVata.Data.Configurations;

public class ManipulatedSensorDataConfiguration : IEntityTypeConfiguration<ManipulatedSensorData>
{
    public void Configure(EntityTypeBuilder<ManipulatedSensorData> b)
    {
        b.ToTable("ManipulatedSensorData", t => t.HasCheckConstraint("CK_ManipulatedSensorData_ID", "[ID] = [SourceSensorDataID]"));
        b.HasKey(m => m.ManipulatedId);
        b.Property(m => m.ManipulatedId).HasColumnName("ManipulatedSensorDataID").UseIdentityColumn();
        b.Property(m => m.SourceSensorDataId).HasColumnName("SourceSensorDataID");
        b.Property(m => m.Id).HasColumnName("ID");
        b.Property(m => m.DeviceCode).HasColumnName("device_id").IsRequired().HasMaxLength(64);
        b.Property(m => m.DataDate).HasColumnName("data_date").HasColumnType("date");
        b.Property(m => m.DataTime).HasColumnName("data_time").HasColumnType("time(3)");
        b.Property(m => m.RecordedAt).HasColumnName("recorded_at").HasColumnType("datetime2(3)");
        b.Property(m => m.Aqi).HasColumnName("aqi");
        b.Property(m => m.AqiStatus).HasColumnName("aqi_status").HasMaxLength(32);
        b.Property(m => m.Pm10).HasColumnName("pm10").HasPrecision(8, 2);
        b.Property(m => m.Pm25).HasColumnName("pm25").HasPrecision(8, 2);
        b.Property(m => m.No2Ppm).HasColumnName("no2_ppm").HasPrecision(10, 4);
        b.Property(m => m.So2Ppm).HasColumnName("so2_ppm").HasPrecision(10, 4);
        b.Property(m => m.CoPpm).HasColumnName("co_ppm").HasPrecision(10, 4);
        b.Property(m => m.TvocPpb).HasColumnName("tvoc_ppb").HasPrecision(10, 2);
        b.Property(m => m.Humidity).HasColumnName("humidity").HasPrecision(5, 2);
        b.Property(m => m.Temperature).HasColumnName("temperature").HasPrecision(6, 2);
        b.Property(m => m.OuterTemperature).HasColumnName("outer_temperature").HasPrecision(6, 2);
        b.Property(m => m.OuterHumidity).HasColumnName("outer_humidity").HasPrecision(5, 2);
        b.Property(m => m.CreatedAt).HasColumnName("created_at").HasColumnType("datetime2(3)");
        // When SQL Server processed the reading (UTC), set by the column default - never supplied by the caller.
        b.Property(m => m.ProcessedAt).HasColumnName("processed_at").HasColumnType("datetime2(3)")
            .HasDefaultValueSql("SYSUTCDATETIME()").ValueGeneratedOnAdd();

        b.HasOne(m => m.Source).WithMany().HasForeignKey(m => m.SourceSensorDataId).OnDelete(DeleteBehavior.Restrict);
        // Exactly one manipulated row per source reading (also what makes ProcessSensorData idempotent).
        b.HasIndex(m => m.SourceSensorDataId).IsUnique().HasDatabaseName("UX_ManipulatedSensorData_Source");
        b.HasIndex(m => new { m.DeviceCode, m.RecordedAt }).HasDatabaseName("IX_ManipulatedSensorData_device_recorded");
    }
}
