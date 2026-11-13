using VayuVata.Helpers;

namespace VayuVata.DTOs.Registration;

/// <summary>Public registration (one link for Admin and User). Super Admin cannot be requested.</summary>
public class RegisterRequest
{
    public string FullName { get; set; } = "";
    public string Email { get; set; } = "";
    public string Mobile { get; set; } = "";
    /// <summary>"Admin" or "User".</summary>
    public string RequestedRole { get; set; } = "User";
    /// <summary>Required for a User: the email of an approved Admin the User will belong to.</summary>
    public string? AdminEmail { get; set; }
    /// <summary>Optional: the Device ID of the applicant's device. After approval it is assigned to the new account automatically.</summary>
    public string? DeviceId { get; set; }
}

public class RegisterResponse
{
    public int RequestId { get; set; }
    public string Status { get; set; } = "Pending";
    public string Message { get; set; } = "";
}

public class RegistrationRequestDto
{
    public int Id { get; set; }
    public string FullName { get; set; } = "";
    public string Email { get; set; } = "";
    public string Mobile { get; set; } = "";
    public string RequestedRole { get; set; } = "";
    public string? AdminEmail { get; set; }
    public int? AdminUserId { get; set; }
    public string? AdminName { get; set; }
    /// <summary>The device the applicant asked for (Device ID).</summary>
    public string? DeviceId { get; set; }
    /// <summary>For a pending request: NotRegistered (create it first) | Free | Assigned (see DeviceOwnerName) | Inactive. Null when no device was given.</summary>
    public string? DeviceStatus { get; set; }
    public string? DeviceOwnerName { get; set; }
    public string Status { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime? DecidedAt { get; set; }
    public string? DecidedByName { get; set; }
    public string? DecisionNote { get; set; }
    public string? ApprovedRole { get; set; }
    public int? UserId { get; set; }
    /// <summary>Pending activation | Active | Inactive: of the account created on approval.</summary>
    public string? ActivationStatus { get; set; }
}

public class RegistrationQuery : PageQuery
{
    /// <summary>Pending | Approved | Rejected (empty = all)</summary>
    public string? Status { get; set; }
    public string? Search { get; set; }
}

public class ApproveRegistrationRequest
{
    /// <summary>Role to grant (Admin or User). Omit to grant what was requested.</summary>
    public string? Role { get; set; }
    /// <summary>For a User: the approved Admin to attach the User to. Omit to use the Admin the applicant entered.</summary>
    public int? AdminId { get; set; }
    /// <summary>Extra devices (database ids) to assign to the new account.</summary>
    public List<int> DeviceIds { get; set; } = [];
    /// <summary>Assign the device the applicant entered, automatically (default true).</summary>
    public bool AssignRequestedDevice { get; set; } = true;
    /// <summary>Allow taking a device that is currently assigned to someone outside the applicant's Admin.</summary>
    public bool Reassign { get; set; }
    public string? Note { get; set; }
}

public class RejectRegistrationRequest
{
    public string? Reason { get; set; }
}

/// <summary>Super Admin creates an account directly: it is approved at once and the person receives an activation invitation.</summary>
public class InviteUserRequest
{
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string Mobile { get; set; } = "";
    /// <summary>"Admin" or "User".</summary>
    public string Role { get; set; } = "User";
    /// <summary>Required for a User: the email of an approved Admin.</summary>
    public string? AdminEmail { get; set; }
    public List<int> DeviceIds { get; set; } = [];
    /// <summary>Allow taking a device that is currently assigned to someone outside the Admin's own devices.</summary>
    public bool Reassign { get; set; }
}

public class InviteResultDto
{
    public int UserId { get; set; }
    public string Email { get; set; } = "";
    public string Role { get; set; } = "";
    public string ActivationStatus { get; set; } = "";
    public DateTime InvitationExpiresAt { get; set; }
    /// <summary>One entry per email that was sent or tried: recipient, what it was, outcome.</summary>
    public List<EmailOutcomeDto> Emails { get; set; } = [];
}

public class EmailOutcomeDto
{
    public string To { get; set; } = "";
    public string Template { get; set; } = "";
    public string Status { get; set; } = "";
}

public class ActivationCheckRequest { public string Token { get; set; } = ""; }
public class ActivationCheckResponse
{
    public bool Valid { get; set; }
    public string? Name { get; set; }
    public string? Email { get; set; }
    public string? Role { get; set; }
}
public class ActivateRequest
{
    public string Token { get; set; } = "";
    public string Password { get; set; } = "";
}

public class AccountHistoryDto
{
    public long Id { get; set; }
    public DateTime At { get; set; }
    public string Action { get; set; } = "";
    public string? ActorName { get; set; }
    public int? RequestId { get; set; }
    public int? TargetUserId { get; set; }
    public string? TargetName { get; set; }
    public string? Detail { get; set; }
}

public class HistoryQuery2 : PageQuery
{
    public string? Action { get; set; }
}

public class EmailLogDto
{
    public long Id { get; set; }
    public DateTime At { get; set; }
    public string ToEmail { get; set; } = "";
    public string Subject { get; set; } = "";
    public string Template { get; set; } = "";
    public string Status { get; set; } = "";
    public string? Error { get; set; }
}

public class AdminMappingDto
{
    public int? AdminId { get; set; }
    public string AdminName { get; set; } = "";
    public string? AdminEmail { get; set; }
    public string? AdminStatus { get; set; }
    public List<MappedUserDto> Users { get; set; } = [];
}

public class MappedUserDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string ActivationStatus { get; set; } = "";
    public List<string> Devices { get; set; } = [];
}

public class RegistrationLinkDto { public string Url { get; set; } = ""; public bool EmailConfigured { get; set; } }
public class SendRegistrationLinkRequest { public string Email { get; set; } = ""; }
