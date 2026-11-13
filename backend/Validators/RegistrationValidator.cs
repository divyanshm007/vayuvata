using System.Text.RegularExpressions;
using FluentValidation;
using VayuVata.DTOs.Registration;
using VayuVata.Models;

namespace VayuVata.Validators;

public static partial class ContactRules
{
    [GeneratedRegex(@"^\+?[0-9]{10,15}$")] private static partial Regex MobilePattern();

    /// <summary>Spaces, dashes and brackets are allowed when typing; what is stored is digits with an optional leading +.</summary>
    public static string CleanMobile(string? v) => Regex.Replace(v ?? "", @"[\s\-\(\)\.]", "");
    public static bool IsMobile(string? v) => MobilePattern().IsMatch(CleanMobile(v));
}

public class RegisterValidator : AbstractValidator<RegisterRequest>
{
    public RegisterValidator()
    {
        RuleFor(x => x.FullName).NotEmpty().MinimumLength(2).MaximumLength(150);
        RuleFor(x => x.Email).NotEmpty().MaximumLength(256).EmailAddress();
        RuleFor(x => x.Mobile).Must(ContactRules.IsMobile).WithMessage("Enter a valid mobile number (10 to 15 digits, optional + at the start).");
        // Super Admin can never be requested through the public link.
        RuleFor(x => x.RequestedRole).Must(r => r == Roles.Admin || r == Roles.User).WithMessage("Requested role must be 'Admin' or 'User'.");
        RuleFor(x => x.AdminEmail).NotEmpty().WithMessage("The email address of your Admin is required.").EmailAddress().MaximumLength(256).When(x => x.RequestedRole == Roles.User);
        RuleFor(x => x.DeviceId).MaximumLength(64).Matches("^[A-Za-z0-9_:-]+$").WithMessage("Device ID may contain only letters, digits, '-', '_' and ':'.").When(x => !string.IsNullOrWhiteSpace(x.DeviceId));
    }
}

public class InviteUserValidator : AbstractValidator<InviteUserRequest>
{
    public InviteUserValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MinimumLength(2).MaximumLength(150);
        RuleFor(x => x.Email).NotEmpty().MaximumLength(256).EmailAddress();
        RuleFor(x => x.Mobile).Must(ContactRules.IsMobile).WithMessage("Enter a valid mobile number (10 to 15 digits, optional + at the start).");
        RuleFor(x => x.Role).Must(r => r == Roles.Admin || r == Roles.User).WithMessage("Role must be 'Admin' or 'User'.");
        RuleFor(x => x.AdminEmail).NotEmpty().WithMessage("The associated Admin's email is required for a User.").EmailAddress().MaximumLength(256).When(x => x.Role == Roles.User);
        RuleFor(x => x.DeviceIds).Must(d => d.Count <= 50).WithMessage("At most 50 devices at a time.");
    }
}

public class ActivateValidator : AbstractValidator<ActivateRequest>
{
    public ActivateValidator()
    {
        RuleFor(x => x.Token).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Password).Strong();
    }
}

public class SendRegistrationLinkValidator : AbstractValidator<SendRegistrationLinkRequest>
{
    public SendRegistrationLinkValidator() => RuleFor(x => x.Email).NotEmpty().MaximumLength(256).EmailAddress();
}
