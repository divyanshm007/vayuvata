using FluentValidation;
using VayuVata.DTOs.SensorData;

namespace VayuVata.Validators;

public class CreateSensorDataValidator : AbstractValidator<CreateSensorDataRequest>
{
    public CreateSensorDataValidator()
    {
        RuleFor(x => x.DeviceId).NotEmpty().MaximumLength(64);
        RuleFor(x => x.RecordedAt).Must(t => t == null || t.Value.ToUniversalTime() <= DateTime.UtcNow.AddMinutes(5))
            .WithMessage("RecordedAt cannot be in the future.")
            .Must(t => t == null || t.Value.ToUniversalTime() >= new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc))
            .WithMessage("RecordedAt is implausibly old.");
        RuleFor(x => x.Aqi).InclusiveBetween(0, 1000);
        RuleFor(x => x.AqiStatus).MaximumLength(32);
        RuleFor(x => x.Pm10).InclusiveBetween(0m, 10000m);
        RuleFor(x => x.Pm25).InclusiveBetween(0m, 10000m);
        RuleFor(x => x.No2Ppm).InclusiveBetween(0m, 1000m);
        RuleFor(x => x.So2Ppm).InclusiveBetween(0m, 1000m);
        RuleFor(x => x.CoPpm).InclusiveBetween(0m, 10000m);
        RuleFor(x => x.TvocPpb).InclusiveBetween(0m, 1000000m);
        RuleFor(x => x.Humidity).InclusiveBetween(0m, 100m);
        RuleFor(x => x.OuterHumidity).InclusiveBetween(0m, 100m);
        RuleFor(x => x.Temperature).InclusiveBetween(-60m, 150m);
        RuleFor(x => x.OuterTemperature).InclusiveBetween(-60m, 150m);
    }
}
