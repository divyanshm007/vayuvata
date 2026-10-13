using FluentValidation;
using VayuVata.DTOs.Auth;

namespace VayuVata.Validators;

public class LoginValidator : AbstractValidator<LoginRequest>
{
    public LoginValidator()
    {
        RuleFor(x => x.Email).NotEmpty().MaximumLength(256);
        RuleFor(x => x.Password).NotEmpty().MaximumLength(200);
    }
}

public class RefreshValidator : AbstractValidator<RefreshRequest>
{
    public RefreshValidator() => RuleFor(x => x.RefreshToken).NotEmpty().MaximumLength(200);
}

public class ChangePasswordValidator : AbstractValidator<ChangePasswordRequest>
{
    public ChangePasswordValidator()
    {
        RuleFor(x => x.CurrentPassword).NotEmpty().MaximumLength(200);
        RuleFor(x => x.NewPassword).Strong();
        RuleFor(x => x.NewPassword).NotEqual(x => x.CurrentPassword)
            .WithMessage("The new password must be different from the current password.");
    }
}
