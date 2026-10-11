using FluentValidation;
using VayuVata.DTOs.Devices;

namespace VayuVata.Validators;

public class CreateDeviceValidator : AbstractValidator<CreateDeviceRequest>
{
    public CreateDeviceValidator()
    {
        RuleFor(x => x.DeviceId).NotEmpty().MaximumLength(64)
            .Matches("^[A-Za-z0-9_:-]+$").WithMessage("DeviceId may contain only letters, digits, '-', '_' and ':'.");
        RuleFor(x => x.DeviceName).NotEmpty().MaximumLength(150);
        RuleFor(x => x.Description).MaximumLength(500);
    }
}

public class UpdateDeviceValidator : AbstractValidator<UpdateDeviceRequest>
{
    public UpdateDeviceValidator()
    {
        RuleFor(x => x.DeviceName).NotEmpty().MaximumLength(150);
        RuleFor(x => x.Description).MaximumLength(500);
    }
}

public class AssignDeviceValidator : AbstractValidator<AssignDeviceRequest>
{
    public AssignDeviceValidator()
    {
        RuleFor(x => x.UserId).GreaterThan(0);
        RuleFor(x => x.Notes).MaximumLength(500);
    }
}
