using FluentValidation;
using VayuVata.DTOs.Users;
using VayuVata.Models;

namespace VayuVata.Validators;

public static class PasswordRules
{
    public static IRuleBuilderOptions<T, string> Strong<T>(this IRuleBuilder<T, string> rb) => rb
        .NotEmpty().MinimumLength(10).MaximumLength(100)
        .Matches("[A-Z]").WithMessage("Password must contain an uppercase letter.")
        .Matches("[a-z]").WithMessage("Password must contain a lowercase letter.")
        .Matches("[0-9]").WithMessage("Password must contain a digit.");
}

public class CreateUserValidator : AbstractValidator<CreateUserRequest>
{
    public CreateUserValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(150);
        RuleFor(x => x.Email).NotEmpty().MaximumLength(256).EmailAddress();
        RuleFor(x => x.Password).Strong();
        RuleFor(x => x.Role).Must(r => r == Roles.Admin || r == Roles.User)
            .WithMessage("Role must be 'Admin' or 'User'.");
        RuleFor(x => x.ManagerId).GreaterThan(0).When(x => x.ManagerId != null);
    }
}

public class CreateManagedUserValidator : AbstractValidator<CreateManagedUserRequest>
{
    public CreateManagedUserValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(150);
        RuleFor(x => x.Email).NotEmpty().MaximumLength(256).EmailAddress();
        RuleFor(x => x.Password).Strong();
    }
}

public class UpdateUserValidator : AbstractValidator<UpdateUserRequest>
{
    public UpdateUserValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(150);
        RuleFor(x => x.Email).NotEmpty().MaximumLength(256).EmailAddress();
    }
}

public class ManagerAssignmentValidator : AbstractValidator<ManagerAssignmentRequest>
{
    public ManagerAssignmentValidator() =>
        RuleFor(x => x.ManagerId).NotNull()
            .WithMessage("ManagerId is required: an active Admin's id, or the SuperAdmin's own id for a standalone User.")
            .GreaterThan(0);
}

public class ResetPasswordValidator : AbstractValidator<ResetPasswordRequest>
{
    public ResetPasswordValidator() => RuleFor(x => x.NewPassword).Strong();
}
