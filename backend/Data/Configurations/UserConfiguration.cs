using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using VayuVata.Models;

namespace VayuVata.Data.Configurations;

public class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> b)
    {
        b.ToTable("Users", t =>
        {
            t.HasCheckConstraint("CK_Users_Role", "[Role] IN ('SuperAdmin','Admin','User')");
            // SuperAdmin/Admin have no manager. A regular User always has one (an Admin, or the SuperAdmin for
            // standalone Users) and never manages themselves. TR_Users_ManagerRules additionally requires the
            // manager to be an Admin or SuperAdmin, which cannot be expressed as a single-row CHECK.
            t.HasCheckConstraint("CK_Users_Manager",
                "(([Role] = 'User' AND [ManagerId] IS NOT NULL AND [ManagerId] <> [Id]) OR ([Role] IN ('SuperAdmin','Admin') AND [ManagerId] IS NULL))");
            t.HasTrigger("TR_Users_ManagerRules");
        });
        b.HasKey(u => u.Id);
        b.Property(u => u.Name).IsRequired().HasMaxLength(150);
        b.Property(u => u.Email).IsRequired().HasMaxLength(256);
        b.Property(u => u.PasswordHash).IsRequired().HasMaxLength(200);
        b.Property(u => u.Role).IsRequired().HasMaxLength(20);
        b.Property(u => u.IsActive).HasDefaultValue(true);
        b.Property(u => u.CreatedAt).HasColumnType("datetime2(3)").HasDefaultValueSql("SYSUTCDATETIME()");
        b.Property(u => u.UpdatedAt).HasColumnType("datetime2(3)");
        b.Property(u => u.LastLoginAt).HasColumnType("datetime2(3)");

        b.HasIndex(u => u.Email).IsUnique();
        b.HasIndex(u => u.ManagerId);
        b.HasOne(u => u.Manager).WithMany().HasForeignKey(u => u.ManagerId).OnDelete(DeleteBehavior.Restrict);
    }
}
