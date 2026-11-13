using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using VayuVata.Models;

namespace VayuVata.Data.Configurations;

public class LocationNameConfiguration : IEntityTypeConfiguration<LocationName>
{
    public void Configure(EntityTypeBuilder<LocationName> b)
    {
        b.ToTable("LocationNames");
        b.Property(x => x.LatKey).HasPrecision(8, 4);
        b.Property(x => x.LonKey).HasPrecision(8, 4);
        b.Property(x => x.Name).IsRequired().HasMaxLength(300);
        b.Property(x => x.FetchedAt).HasColumnType("datetime2(3)").HasDefaultValueSql("SYSUTCDATETIME()");
        b.HasIndex(x => new { x.LatKey, x.LonKey }).IsUnique().HasDatabaseName("UX_LocationNames_position");
    }
}
