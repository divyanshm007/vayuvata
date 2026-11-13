using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using VayuVata.Models;

namespace VayuVata.Data.Configurations;

public class RegistrationRequestConfiguration : IEntityTypeConfiguration<RegistrationRequest>
{
    public void Configure(EntityTypeBuilder<RegistrationRequest> b)
    {
        b.ToTable("RegistrationRequests", t =>
        {
            t.HasCheckConstraint("CK_RegistrationRequests_Role", "[RequestedRole] IN ('Admin','User')");   // Super Admin can never be requested
            t.HasCheckConstraint("CK_RegistrationRequests_Status", "[Status] IN ('Pending','Approved','Rejected')");
        });
        b.Property(r => r.FullName).IsRequired().HasMaxLength(150);
        b.Property(r => r.Email).IsRequired().HasMaxLength(256);
        b.Property(r => r.Mobile).IsRequired().HasMaxLength(20).IsUnicode(false);
        b.Property(r => r.RequestedRole).IsRequired().HasMaxLength(20).IsUnicode(false);
        b.Property(r => r.AdminEmail).HasMaxLength(256);
        b.Property(r => r.DeviceCode).HasMaxLength(64);
        b.Property(r => r.Status).IsRequired().HasMaxLength(10).IsUnicode(false);
        b.Property(r => r.ApprovedRole).HasMaxLength(20).IsUnicode(false);
        b.Property(r => r.DecisionNote).HasMaxLength(500);
        b.Property(r => r.CreatedAt).HasColumnType("datetime2(3)").HasDefaultValueSql("SYSUTCDATETIME()");
        b.Property(r => r.DecidedAt).HasColumnType("datetime2(3)");
        b.HasOne(r => r.AdminUser).WithMany().HasForeignKey(r => r.AdminUserId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(r => r.DecidedBy).WithMany().HasForeignKey(r => r.DecidedByUserId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(r => r.User).WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Restrict);
        // one open request per email
        b.HasIndex(r => r.Email).IsUnique().HasFilter("[Status] = 'Pending'").HasDatabaseName("UX_RegistrationRequests_pending_email");
        b.HasIndex(r => new { r.Status, r.CreatedAt }).HasDatabaseName("IX_RegistrationRequests_status");
    }
}

public class AccountInvitationConfiguration : IEntityTypeConfiguration<AccountInvitation>
{
    public void Configure(EntityTypeBuilder<AccountInvitation> b)
    {
        b.ToTable("AccountInvitations");
        b.Property(i => i.TokenHash).IsRequired().HasMaxLength(100).IsUnicode(false);
        b.Property(i => i.CreatedAt).HasColumnType("datetime2(3)").HasDefaultValueSql("SYSUTCDATETIME()");
        b.Property(i => i.ExpiresAt).HasColumnType("datetime2(3)");
        b.Property(i => i.UsedAt).HasColumnType("datetime2(3)");
        b.Property(i => i.RevokedAt).HasColumnType("datetime2(3)");
        b.HasOne(i => i.User).WithMany().HasForeignKey(i => i.UserId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(i => i.TokenHash).IsUnique().HasDatabaseName("UX_AccountInvitations_token");
        b.HasIndex(i => i.UserId).HasDatabaseName("IX_AccountInvitations_user");
    }
}

public class AccountHistoryConfiguration : IEntityTypeConfiguration<AccountHistory>
{
    public void Configure(EntityTypeBuilder<AccountHistory> b)
    {
        b.ToTable("AccountHistory");
        b.Property(h => h.At).HasColumnType("datetime2(3)").HasDefaultValueSql("SYSUTCDATETIME()");
        b.Property(h => h.Action).IsRequired().HasMaxLength(30).IsUnicode(false);
        b.Property(h => h.Detail).HasMaxLength(500);
        b.HasOne(h => h.Actor).WithMany().HasForeignKey(h => h.ActorUserId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(h => h.TargetUser).WithMany().HasForeignKey(h => h.TargetUserId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(h => h.At).HasDatabaseName("IX_AccountHistory_at");
    }
}

public class EmailLogConfiguration : IEntityTypeConfiguration<EmailLog>
{
    public void Configure(EntityTypeBuilder<EmailLog> b)
    {
        b.ToTable("EmailLogs");
        b.Property(e => e.At).HasColumnType("datetime2(3)").HasDefaultValueSql("SYSUTCDATETIME()");
        b.Property(e => e.ToEmail).IsRequired().HasMaxLength(256);
        b.Property(e => e.Subject).IsRequired().HasMaxLength(200);
        b.Property(e => e.Template).IsRequired().HasMaxLength(40).IsUnicode(false);
        b.Property(e => e.Status).IsRequired().HasMaxLength(15).IsUnicode(false);
        b.Property(e => e.Error).HasMaxLength(300);
        b.HasIndex(e => e.At).HasDatabaseName("IX_EmailLogs_at");
    }
}
