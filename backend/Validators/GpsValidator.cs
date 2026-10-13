using FluentValidation;
using VayuVata.DTOs.Gps;

namespace VayuVata.Validators;

public class CreateGpsLocationValidator : AbstractValidator<CreateGpsLocationRequest>
{
    public CreateGpsLocationValidator()
    {
        RuleFor(x => x.DeviceId).NotEmpty().MaximumLength(50);
        RuleFor(x => x.RecordedAt).NotNull().WithMessage("recordedAt is required (ISO-8601 UTC).")
            .Must(t => t == null || Utc(t.Value) <= DateTime.UtcNow.AddMinutes(5)).WithMessage("recordedAt cannot be in the future.")
            .Must(t => t == null || Utc(t.Value) >= new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc)).WithMessage("recordedAt is implausibly old.");
        RuleFor(x => x.Fix).NotNull().WithMessage("fix is required (true or false).");
        RuleFor(x => x.Source).Must(s => s is "gps" or "cell").WithMessage("source must be 'gps' or 'cell'.");

        // A fix carries a position ...
        When(x => x.Fix == true, () =>
        {
            RuleFor(x => x.Lat).NotNull().WithMessage("lat is required when fix is true.").InclusiveBetween(-90m, 90m);
            RuleFor(x => x.Lon).NotNull().WithMessage("lon is required when fix is true.").InclusiveBetween(-180m, 180m);
            RuleFor(x => x.AltM).InclusiveBetween(-1000m, 99999m);
            RuleFor(x => x.SpeedKmh).InclusiveBetween(0m, 1500m);
        });
        // ... a "no fix" report carries none (stored as NULL, never 0).
        When(x => x.Fix == false, () =>
        {
            RuleFor(x => x.Lat).Null().WithMessage("lat must be null when fix is false.");
            RuleFor(x => x.Lon).Null().WithMessage("lon must be null when fix is false.");
            RuleFor(x => x.AltM).Null().WithMessage("altM must be null when fix is false.");
            RuleFor(x => x.SpeedKmh).Null().WithMessage("speedKmh must be null when fix is false.");
        });
        RuleFor(x => x.SignalPct).InclusiveBetween(0, 100);
    }

    /// <summary>recordedAt is UTC by contract: "Z" values stay as they are, offsets are converted, a bare timestamp is read as UTC.</summary>
    public static DateTime Utc(DateTime t) =>
        t.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(t, DateTimeKind.Utc) : t.ToUniversalTime();
}
