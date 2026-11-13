namespace VayuVata.Models;

public static class RegistrationStatus
{
    public const string Pending = "Pending";
    public const string Approved = "Approved";
    public const string Rejected = "Rejected";
}

/// <summary>
/// A public registration (Admin or User). It is NOT an account: no row exists in dbo.Users until the SuperAdmin approves it,
/// so a pending or rejected request can never log in. Super Admin cannot be requested.
/// </summary>
public class RegistrationRequest
{
    public int Id { get; set; }
    public string FullName { get; set; } = "";
    public string Email { get; set; } = "";
    public string Mobile { get; set; } = "";
    /// <summary>Admin | User (what the applicant asked for).</summary>
    public string RequestedRole { get; set; } = Roles.User;
    /// <summary>For a User request: the Admin email the applicant entered (stored as typed, lower-case).</summary>
    public string? AdminEmail { get; set; }
    /// <summary>The approved Admin that email resolved to when the request was submitted.</summary>
    public int? AdminUserId { get; set; }
    public User? AdminUser { get; set; }
    /// <summary>The device the applicant says they own (its Device ID, e.g. Vayu_004). On approval it is assigned to the new account automatically.</summary>
    public string? DeviceCode { get; set; }
    public string Status { get; set; } = RegistrationStatus.Pending;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DecidedAt { get; set; }
    public int? DecidedByUserId { get; set; }
    public User? DecidedBy { get; set; }
    public string? DecisionNote { get; set; }
    /// <summary>The role the SuperAdmin actually granted (may differ from the requested one).</summary>
    public string? ApprovedRole { get; set; }
    /// <summary>The account created on approval.</summary>
    public int? UserId { get; set; }
    public User? User { get; set; }
}

/// <summary>A single-use, expiring activation link. Only the SHA-256 of the token is stored; the token itself exists only in the email.</summary>
public class AccountInvitation
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User User { get; set; } = null!;
    public string TokenHash { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
    public DateTime? UsedAt { get; set; }
    /// <summary>Set when a newer invitation replaced this one (resend).</summary>
    public DateTime? RevokedAt { get; set; }
    public int? CreatedByUserId { get; set; }
}

/// <summary>Insert-only trail of registrations, approvals, rejections, account creation, invitations and activations.</summary>
public class AccountHistory
{
    public long Id { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
    /// <summary>Who did it; null for the public (an applicant) or the system.</summary>
    public int? ActorUserId { get; set; }
    public User? Actor { get; set; }
    /// <summary>Registered | Approved | Rejected | DirectCreated | InvitationSent | InvitationResent | Activated | RegistrationLinkSent</summary>
    public string Action { get; set; } = "";
    public int? RequestId { get; set; }
    public int? TargetUserId { get; set; }
    public User? TargetUser { get; set; }
    public string? Detail { get; set; }
}

/// <summary>Every email the system tried to send: who, what, and the outcome. The body is never stored (it can contain activation links).</summary>
public class EmailLog
{
    public long Id { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
    public string ToEmail { get; set; } = "";
    public string Subject { get; set; } = "";
    public string Template { get; set; } = "";
    /// <summary>Sent | Failed | NotConfigured</summary>
    public string Status { get; set; } = "";
    public string? Error { get; set; }
    public int? RequestId { get; set; }
    public int? UserId { get; set; }
}
