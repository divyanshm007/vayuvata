using VayuVata.Helpers;

namespace VayuVata.DTOs.Users;

/// <summary>
/// Create an account. <b>ManagerId semantics:</b> a regular User is managed by an Admin (<c>ManagerId</c> = that Admin)
/// or directly by the SuperAdmin (a "standalone" User, <c>ManagerId</c> = the SuperAdmin's id). SuperAdmin and Admin
/// accounts have no manager.
/// </summary>
public class CreateUserRequest
{
    /// <example>Amit Verma</example>
    public string Name { get; set; } = "";
    /// <example>amit@example.com</example>
    public string Email { get; set; } = "";
    /// <example>StrongPassword123!</example>
    public string Password { get; set; } = "";
    /// <summary>"Admin" or "User". Only a SuperAdmin may create an Admin. SuperAdmin accounts can never be created through the API.</summary>
    /// <example>User</example>
    public string Role { get; set; } = "User";
    /// <summary>
    /// SuperAdmin creating a User: id of an active Admin, or omit it to create a standalone User (the backend then sets
    /// ManagerId to the SuperAdmin's own id). Admin creating a User: omit (or send their own id); the manager is always the
    /// authenticated Admin. Not allowed for Admin accounts.
    /// </summary>
    /// <example>12</example>
    public int? ManagerId { get; set; }
}

/// <summary>Body for POST /admins/{adminId}/users. Role is always User and the manager is the Admin in the route.</summary>
public class CreateManagedUserRequest
{
    /// <example>Priya Sharma</example>
    public string Name { get; set; } = "";
    /// <example>priya@example.com</example>
    public string Email { get; set; } = "";
    /// <example>StrongPassword123!</example>
    public string Password { get; set; } = "";
}

public class UpdateUserRequest
{
    /// <example>Amit Verma</example>
    public string Name { get; set; } = "";
    /// <example>amit@example.com</example>
    public string Email { get; set; } = "";
}

public class SetStatusRequest
{
    /// <example>false</example>
    public bool IsActive { get; set; }
}

/// <summary>
/// Change a regular User's manager (SuperAdmin only). <c>managerId</c> is required and never means "standalone by omission":
/// send an active Admin's id to assign the User to that Admin, or the SuperAdmin's own id to make the User standalone.
/// </summary>
public class ManagerAssignmentRequest
{
    /// <example>12</example>
    public int? ManagerId { get; set; }
}

public class ResetPasswordRequest
{
    /// <example>NewStrongPass456!</example>
    public string NewPassword { get; set; } = "";
}

public class UserQuery : PageQuery
{
    /// <summary>Case-insensitive match on name or email.</summary>
    public string? Search { get; set; }
    public string? Role { get; set; }
    /// <summary>SuperAdmin only: only accounts managed by this id. An Admin may only pass their own id.</summary>
    public int? ManagerId { get; set; }
    /// <summary>SuperAdmin only: true = standalone Users (managed by a SuperAdmin), false = Admin-managed Users.</summary>
    public bool? Standalone { get; set; }
    public bool? IsActive { get; set; }
}

public class ManagedUsersQuery : PageQuery
{
    public string? Search { get; set; }
    public bool? IsActive { get; set; }
}

public class UserDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string Role { get; set; } = "";
    /// <summary>NULL for SuperAdmin and Admin; otherwise the managing Admin or SuperAdmin.</summary>
    public int? ManagerId { get; set; }
    public string? ManagerName { get; set; }
    /// <summary>"Admin" or "SuperAdmin" (derived from the manager row).</summary>
    public string? ManagerRole { get; set; }
    /// <summary>"Standalone" (managed by the SuperAdmin), "AdminManaged", or null for Admin/SuperAdmin accounts.</summary>
    public string? AssignmentType { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public DateTime? LastLoginAt { get; set; }
}

/// <summary>Page of Users managed by one Admin (GET /admins/{adminId}/users).</summary>
public class AdminUsersPage : PagedResult<UserDto>
{
    public int AdminId { get; set; }
    public string AdminName { get; set; } = "";
}
