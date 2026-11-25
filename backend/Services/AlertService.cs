using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using VayuVata.Authorization;
using VayuVata.Data;
using VayuVata.DTOs.Alerts;
using VayuVata.Helpers;
using VayuVata.Models;
using static VayuVata.Services.EmailTemplates;

namespace VayuVata.Services;

public class AlertOptions
{
    /// <summary>Runs the evaluation loop. Off in Development so a laptop never writes alerts or sends emails by itself (use POST /alerts/evaluate).</summary>
    public bool Enabled { get; set; } = true;
    public int IntervalMinutes { get; set; } = 15;
    /// <summary>Sensor times are stored as India time (UTC+5:30).</summary>
    public int UtcOffsetMinutes { get; set; } = 330;
    /// <summary>Lets the Super Admin run an evaluation "as of" another time (testing against history). Off everywhere except Development.</summary>
    public bool AllowAsOf { get; set; }
}

/// <summary>
/// Alerts, kept in three separate categories: Maintenance (filter replacement every 1.5 months, bin cleaning every 3 months, both configurable), Machine errors (device offline, outer sensor
/// not delivering) and Abnormal readings (AQI or temperature far from the previous 5-day average). Statuses: Normal (watching), Warning, Critical, Resolved.
/// Abnormal readings: after 7 hours a Warning goes to the Super Admin; beyond 24 hours the alert becomes Critical and also goes to the Admin and the User. All timings and thresholds are
/// settings of the Super Admin. Every change is written to the history and emailed.
/// </summary>
public class AlertService(VayuVataDbContext db, NotificationService notifier, IOptions<AlertOptions> options, ILogger<AlertService> log)
{
    private readonly AlertOptions _o = options.Value;

    // ------------------------------------------------------------------ configuration

    public async Task<AlertConfiguration> ConfigAsync(CancellationToken ct) =>
        await db.AlertConfigurations.FirstOrDefaultAsync(c => c.Id == 1, ct) ?? new AlertConfiguration();

    private static AlertConfigDto ToDto(AlertConfiguration c) => new()
    {
        FilterIntervalDays = c.FilterIntervalDays, BinIntervalDays = c.BinIntervalDays, MaintenanceWarnDaysBefore = c.MaintenanceWarnDaysBefore, MaintenanceCriticalOverdueDays = c.MaintenanceCriticalOverdueDays,
        MaintenanceRepeatDays = c.MaintenanceRepeatDays, BaselineDays = c.BaselineDays, RecentWindowMinutes = c.RecentWindowMinutes, AqiChangePercent = c.AqiChangePercent, AqiMinChange = c.AqiMinChange,
        TempChangeDegrees = c.TempChangeDegrees, MinBaselineSamples = c.MinBaselineSamples, WarningAfterHours = c.WarningAfterHours, CriticalAfterHours = c.CriticalAfterHours,
        ResolveGraceMinutes = c.ResolveGraceMinutes, OfflineAfterMinutes = c.OfflineAfterMinutes, OuterMissingPercent = c.OuterMissingPercent, SensorNoDataMinutes = c.SensorNoDataMinutes, EmailEnabled = c.EmailEnabled, UpdatedAt = c.UpdatedAt,
    };

    public async Task<AlertConfigDto> GetConfigAsync(CurrentUser c, CancellationToken ct)
    {
        if (!c.IsSuperAdmin) throw ApiException.Forbidden();
        return ToDto(await ConfigAsync(ct));
    }

    public async Task<AlertConfigDto> UpdateConfigAsync(AlertConfigDto r, CurrentUser c, CancellationToken ct)
    {
        if (!c.IsSuperAdmin) throw ApiException.Forbidden();
        void Range(string name, decimal v, decimal lo, decimal hi) { if (v < lo || v > hi) throw ApiException.BadRequest($"{name} must be between {lo} and {hi}.", "validation_failed"); }
        Range("Filter replacement interval (days)", r.FilterIntervalDays, 1, 730); Range("Bin cleaning interval (days)", r.BinIntervalDays, 1, 730);
        Range("Maintenance warning (days before due)", r.MaintenanceWarnDaysBefore, 0, 90); Range("Maintenance critical (days overdue)", r.MaintenanceCriticalOverdueDays, 0, 90);
        Range("Maintenance reminder repeat (days)", r.MaintenanceRepeatDays, 1, 90); Range("Baseline (days)", r.BaselineDays, 1, 30); Range("Recent window (minutes)", r.RecentWindowMinutes, 5, 10080);
        Range("AQI change (percent)", r.AqiChangePercent, 0, 1000); Range("AQI minimum change", r.AqiMinChange, 0, 1000); Range("Temperature change (degrees)", r.TempChangeDegrees, 0, 60);
        Range("Minimum baseline readings", r.MinBaselineSamples, 1, 100000); Range("Warning after (hours)", r.WarningAfterHours, 0, 720); Range("Critical after (hours)", r.CriticalAfterHours, 1, 720);
        Range("Resolve grace (minutes)", r.ResolveGraceMinutes, 0, 1440); Range("Offline after (minutes)", r.OfflineAfterMinutes, 5, 10080); Range("Outer sensor missing (percent)", r.OuterMissingPercent, 1, 100); Range("Sensor stopped after (minutes)", r.SensorNoDataMinutes, 1, 60);
        if (r.CriticalAfterHours <= r.WarningAfterHours) throw ApiException.BadRequest("'Critical after' must be longer than 'Warning after'.", "validation_failed");
        var cfg = await db.AlertConfigurations.FirstOrDefaultAsync(x => x.Id == 1, ct);
        if (cfg is null) { cfg = new AlertConfiguration(); db.AlertConfigurations.Add(cfg); }
        cfg.FilterIntervalDays = r.FilterIntervalDays; cfg.BinIntervalDays = r.BinIntervalDays; cfg.MaintenanceWarnDaysBefore = r.MaintenanceWarnDaysBefore; cfg.MaintenanceCriticalOverdueDays = r.MaintenanceCriticalOverdueDays;
        cfg.MaintenanceRepeatDays = r.MaintenanceRepeatDays; cfg.BaselineDays = r.BaselineDays; cfg.RecentWindowMinutes = r.RecentWindowMinutes; cfg.AqiChangePercent = r.AqiChangePercent; cfg.AqiMinChange = r.AqiMinChange;
        cfg.TempChangeDegrees = r.TempChangeDegrees; cfg.MinBaselineSamples = r.MinBaselineSamples; cfg.WarningAfterHours = r.WarningAfterHours; cfg.CriticalAfterHours = r.CriticalAfterHours;
        cfg.ResolveGraceMinutes = r.ResolveGraceMinutes; cfg.OfflineAfterMinutes = r.OfflineAfterMinutes; cfg.OuterMissingPercent = r.OuterMissingPercent; cfg.SensorNoDataMinutes = r.SensorNoDataMinutes; cfg.EmailEnabled = r.EmailEnabled;
        cfg.UpdatedAt = DateTime.UtcNow; cfg.UpdatedByUserId = c.Id;
        await db.SaveChangesAsync(ct);
        log.LogInformation("AUDIT alert configuration changed by SuperAdmin {UserId}", c.Id);
        return ToDto(cfg);
    }

    // ------------------------------------------------------------------ who sees what

    /// <summary>
    /// Super Admin: everything. Admin: Maintenance and Machine errors of their devices, and Abnormal readings once they were escalated (Critical). User: only escalated Abnormal readings of their devices.
    /// Machine errors and maintenance are never shown to a User.
    /// </summary>
    private IQueryable<Alert> Visible(CurrentUser c)
    {
        // a deviation that cleared before it ever warned (Resolved without a Warning) is not an alert and is never shown
        var real = db.Alerts.AsNoTracking().Where(a => a.Status == AlertStatus.Normal || a.WarningAt != null);
        if (c.IsSuperAdmin) return real;
        var devs = db.DataDevices(c).Select(d => d.DeviceId);
        return c.IsAdmin
            ? real.Where(a => devs.Contains(a.DeviceCode) && a.Status != AlertStatus.Normal && (a.Category != AlertCategory.AbnormalReading || a.CriticalAt != null))
            : real.Where(a => devs.Contains(a.DeviceCode) && a.Category == AlertCategory.AbnormalReading && a.CriticalAt != null);
    }

    private static AlertDto Dto(Alert a, string name) => new()
    {
        Id = a.Id, DeviceId = a.DeviceCode, DeviceName = name, Category = a.Category, AlertType = a.AlertType, Status = a.Status, StartedAt = a.StartedAt, WarningAt = a.WarningAt, CriticalAt = a.CriticalAt,
        ResolvedAt = a.ResolvedAt, Value = a.Value, Baseline = a.Baseline, Detail = a.Detail,
    };

    public async Task<PagedResult<AlertDto>> ListAsync(AlertQuery q, CurrentUser c, CancellationToken ct)
    {
        var query = Visible(c);
        if (!string.IsNullOrWhiteSpace(q.Status)) query = query.Where(a => a.Status == q.Status);
        else query = query.Where(a => a.Status != AlertStatus.Resolved && a.Status != AlertStatus.Normal);   // default: what needs attention
        if (!string.IsNullOrWhiteSpace(q.Category)) query = query.Where(a => a.Category == q.Category);
        if (!string.IsNullOrWhiteSpace(q.DeviceId)) query = query.Where(a => a.DeviceCode == q.DeviceId);
        return await query.OrderByDescending(a => a.Status == AlertStatus.Critical).ThenByDescending(a => a.StartedAt).Select(a => new AlertDto
        {
            Id = a.Id, DeviceId = a.DeviceCode, DeviceName = a.Device.DeviceName, Category = a.Category, AlertType = a.AlertType, Status = a.Status, StartedAt = a.StartedAt, WarningAt = a.WarningAt,
            CriticalAt = a.CriticalAt, ResolvedAt = a.ResolvedAt, Value = a.Value, Baseline = a.Baseline, Detail = a.Detail,
        }).ToPagedAsync(q, ct);
    }

    public async Task<AlertSummaryDto> SummaryAsync(CurrentUser c, CancellationToken ct)
    {
        var open = await Visible(c).Where(a => a.Status == AlertStatus.Warning || a.Status == AlertStatus.Critical).Select(a => new { a.DeviceCode, a.Status, a.Category }).ToListAsync(ct);
        var since = DateTime.UtcNow.AddDays(-7);
        var devices = await (c.IsSuperAdmin ? db.Devices.AsNoTracking() : db.DataDevices(c).AsNoTracking()).Where(d => d.IsActive).Select(d => d.DeviceId).ToListAsync(ct);
        var bad = open.Select(o => o.DeviceCode).ToHashSet();
        return new AlertSummaryDto
        {
            TotalDevices = devices.Count, NormalDevices = devices.Count(d => !bad.Contains(d)), WarningAlerts = open.Count(o => o.Status == AlertStatus.Warning), CriticalAlerts = open.Count(o => o.Status == AlertStatus.Critical),
            ResolvedLast7Days = await Visible(c).CountAsync(a => a.Status == AlertStatus.Resolved && a.ResolvedAt >= since, ct),
            MaintenanceOpen = open.Count(o => o.Category == AlertCategory.Maintenance), MachineErrorsOpen = open.Count(o => o.Category == AlertCategory.MachineError), AbnormalReadingsOpen = open.Count(o => o.Category == AlertCategory.AbnormalReading),
        };
    }

    public async Task<PagedResult<AlertEventDto>> HistoryAsync(AlertQuery q, CurrentUser c, CancellationToken ct)
    {
        var ids = Visible(c).Select(a => a.Id);
        var query = db.AlertEvents.AsNoTracking().Where(e => ids.Contains(e.AlertId));
        if (!string.IsNullOrWhiteSpace(q.Category)) query = query.Where(e => e.Category == q.Category);
        if (!string.IsNullOrWhiteSpace(q.DeviceId)) query = query.Where(e => e.DeviceCode == q.DeviceId);
        if (!string.IsNullOrWhiteSpace(q.Status)) query = query.Where(e => e.Status == q.Status);
        return await query.OrderByDescending(e => e.At).ThenByDescending(e => e.Id)
            .Select(e => new AlertEventDto { Id = e.Id, AlertId = e.AlertId, At = e.At, DeviceId = e.DeviceCode, Category = e.Category, AlertType = e.AlertType, Status = e.Status, Detail = e.Detail }).ToPagedAsync(q, ct);
    }

    // ------------------------------------------------------------------ maintenance

    private static (string Status, int DaysLeft, DateTime Due) MaintStatus(DateTime last, int intervalDays, AlertConfiguration cfg, DateTime now)
    {
        var due = last.AddDays(intervalDays);
        var daysLeft = (int)Math.Floor((due - now).TotalDays);
        var status = now >= due.AddDays(cfg.MaintenanceCriticalOverdueDays) ? AlertStatus.Critical : now >= due.AddDays(-cfg.MaintenanceWarnDaysBefore) ? AlertStatus.Warning : AlertStatus.Normal;
        return (status, daysLeft, due);
    }

    public async Task<List<DeviceMaintenanceDto>> MaintenanceAsync(CurrentUser c, CancellationToken ct)
    {
        if (c.IsUser) throw ApiException.Forbidden("Maintenance reminders are for the Super Admin and Admins.");
        var cfg = await ConfigAsync(ct); var now = DateTime.UtcNow;
        var devices = await (c.IsSuperAdmin ? db.Devices.AsNoTracking() : db.DataDevices(c).AsNoTracking()).Where(d => d.IsActive).OrderBy(d => d.DeviceId).Select(d => new { d.DeviceId, d.DeviceName, d.CreatedAt }).ToListAsync(ct);
        var recs = (await db.DeviceMaintenances.AsNoTracking().ToListAsync(ct)).ToDictionary(m => m.DeviceCode);
        MaintenanceItemDto Item(string type, DateTime? done, DateTime created, int interval)
        {
            var s = MaintStatus(done ?? created, interval, cfg, now);
            return new MaintenanceItemDto { AlertType = type, LastDoneAt = done, FromRegistration = done is null, DueAt = s.Due, DaysLeft = s.DaysLeft, Status = s.Status };
        }
        return devices.Select(d =>
        {
            recs.TryGetValue(d.DeviceId, out var m);
            return new DeviceMaintenanceDto { DeviceId = d.DeviceId, DeviceName = d.DeviceName, Filter = Item(AlertType.FilterReplacement, m?.FilterChangedAt, d.CreatedAt, cfg.FilterIntervalDays), Bin = Item(AlertType.BinCleaning, m?.BinCleanedAt, d.CreatedAt, cfg.BinIntervalDays) };
        }).ToList();
    }

    /// <summary>Records that the filter was replaced / the bin cleaned and resolves the matching alert. Super Admin, or the Admin of the device.</summary>
    public async Task<DeviceMaintenanceDto> MarkDoneAsync(string deviceCode, MarkMaintenanceDoneRequest req, CurrentUser c, CancellationToken ct)
    {
        if (c.IsUser) throw ApiException.Forbidden();
        if (req.AlertType is not (AlertType.FilterReplacement or AlertType.BinCleaning)) throw ApiException.BadRequest("alertType must be FilterReplacement or BinCleaning.", "validation_failed");
        var q = c.IsSuperAdmin ? db.Devices : db.DataDevices(c);
        var dev = await q.AsNoTracking().FirstOrDefaultAsync(d => d.DeviceId == deviceCode, ct) ?? throw ApiException.NotFound("Device not found.");
        var now = DateTime.UtcNow;
        var when = req.DoneAt is { } d0 ? (d0.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(d0, DateTimeKind.Utc) : d0.ToUniversalTime()) : now;
        if (when > now.AddMinutes(5)) throw ApiException.BadRequest("The date cannot be in the future.", "validation_failed");
        var m = await db.DeviceMaintenances.FirstOrDefaultAsync(x => x.DeviceCode == deviceCode, ct);
        if (m is null) { m = new DeviceMaintenance { DeviceCode = deviceCode }; db.DeviceMaintenances.Add(m); }
        if (req.AlertType == AlertType.FilterReplacement) m.FilterChangedAt = when; else m.BinCleanedAt = when;
        m.UpdatedAt = now; m.UpdatedByUserId = c.Id;
        var open = await db.Alerts.FirstOrDefaultAsync(a => a.DeviceCode == deviceCode && a.AlertType == req.AlertType && a.Status != AlertStatus.Resolved, ct);
        var cfg = await ConfigAsync(ct);
        var emails = new List<Func<Task>>();
        if (open is not null)
        {
            var wasStatus = open.Status;
            open.Status = AlertStatus.Resolved; open.ResolvedAt = now; open.LastSeenAt = now;
            db.AlertEvents.Add(new AlertEvent { Alert = open, DeviceCode = deviceCode, Category = open.Category, AlertType = open.AlertType, Status = AlertStatus.Resolved, Detail = $"Marked done by {c.Role} {c.Id}" });
            if (wasStatus != AlertStatus.Normal) emails.Add(() => NotifyAsync(open, AlertStatus.Resolved, cfg, ct));
        }
        await db.SaveChangesAsync(ct);
        foreach (var e in emails) await e();
        log.LogInformation("AUDIT maintenance {Type} done for {Device} by {Role} {UserId}", req.AlertType, deviceCode, c.Role, c.Id);
        return (await MaintenanceAsync(c, ct)).First(x => x.DeviceId == deviceCode);
    }

    // ------------------------------------------------------------------ evaluation

    private sealed record Stats(int N, double? Aqi, double? Temp);

    private sealed class Ctx
    {
        public required AlertConfiguration Cfg;
        public required DateTime Now;
        public required Dictionary<(string, string), Alert> Open;
        public int Opened, Escalated, Resolved;
        public List<(Alert Alert, string Status)> ToNotify = [];
        public HashSet<int> Reminded = [];
    }

    private static string Describe(string type) => type switch
    {
        AlertType.FilterReplacement => "Filter replacement", AlertType.BinCleaning => "Bin cleaning", AlertType.DeviceOffline => "Device offline", AlertType.OuterSensorFailure => "Outer sensor not delivering", AlertType.SensorNoData => "Sensor not sending data",
        AlertType.AqiAbnormal => "Abnormal AQI", AlertType.TemperatureAbnormal => "Abnormal temperature", _ => type,
    };

    private void Event(Ctx x, Alert a, string status, string? detail) =>
        db.AlertEvents.Add(new AlertEvent { Alert = a, At = x.Now, DeviceCode = a.DeviceCode, Category = a.Category, AlertType = a.AlertType, Status = status, Detail = detail is { Length: > 300 } ? detail[..300] : detail });

    /// <summary>Tracks one condition over time (abnormal reading, machine error). Opens a watching alert (Normal), raises Warning / Critical when it has lasted long enough, resolves it when it is gone.</summary>
    private void Track(Ctx x, string device, string category, string type, bool active, string detail, decimal? value, decimal? baseline, double warnAfterH, double critAfterH)
    {
        x.Open.TryGetValue((device, type), out var a);
        if (active)
        {
            if (a is null)
            {
                a = new Alert { DeviceCode = device, Category = category, AlertType = type, Status = AlertStatus.Normal, StartedAt = x.Now, LastSeenAt = x.Now };
                db.Alerts.Add(a); x.Open[(device, type)] = a;
            }
            a.LastSeenAt = x.Now; a.Detail = detail.Length > 300 ? detail[..300] : detail; a.Value = value; a.Baseline = baseline;
            var elapsedH = (x.Now - a.StartedAt).TotalHours;
            if (elapsedH >= critAfterH && a.Status != AlertStatus.Critical)
            {
                a.WarningAt ??= x.Now; a.Status = AlertStatus.Critical; a.CriticalAt = x.Now; Event(x, a, AlertStatus.Critical, detail); x.ToNotify.Add((a, AlertStatus.Critical)); x.Escalated++;
            }
            else if (elapsedH >= warnAfterH && a.Status == AlertStatus.Normal)
            {
                a.Status = AlertStatus.Warning; a.WarningAt = x.Now; Event(x, a, AlertStatus.Warning, detail); x.ToNotify.Add((a, AlertStatus.Warning)); x.Opened++;
            }
        }
        else if (a is not null && (x.Now - a.LastSeenAt).TotalMinutes >= x.Cfg.ResolveGraceMinutes)
        {
            x.Open.Remove((device, type));
            if (a.Status == AlertStatus.Normal) { a.Status = AlertStatus.Resolved; a.ResolvedAt = x.Now; return; }   // it never lasted long enough to warn: closed silently (no history, no email, hidden from every list)
            a.Status = AlertStatus.Resolved; a.ResolvedAt = x.Now; Event(x, a, AlertStatus.Resolved, "Back to normal"); x.ToNotify.Add((a, AlertStatus.Resolved)); x.Resolved++;
        }
    }

    private const string SensorPrefix = "No data from: ";

    /// <summary>
    /// A sensor that sent no value for the whole window while the device still sends readings. One alert per device lists the stopped sensors; when one more sensor stops, the Super Admin and the Admin are told again.
    /// </summary>
    private void TrackSensors(Ctx x, string device, List<string> missing, AlertConfiguration cfg)
    {
        x.Open.TryGetValue((device, AlertType.SensorNoData), out var existing);
        var previous = existing?.Detail is { } d && d.StartsWith(SensorPrefix) ? d[SensorPrefix.Length..].Split(" (")[0].Split(", ").ToHashSet() : [];
        var detail = missing.Count == 0 ? "" : $"{SensorPrefix}{string.Join(", ", missing)} (for {cfg.SensorNoDataMinutes}+ minutes)";
        Track(x, device, AlertCategory.MachineError, AlertType.SensorNoData, missing.Count > 0, detail, missing.Count, null, 0, cfg.CriticalAfterHours);
        if (existing is { Status: AlertStatus.Warning or AlertStatus.Critical } && missing.Any(m => !previous.Contains(m)) && !x.ToNotify.Any(n => n.Alert == existing))
        {
            Event(x, existing, existing.Status, "Another sensor stopped: " + detail);
            x.ToNotify.Add((existing, existing.Status));
        }
    }

    private void Maintenance(Ctx x, string device, string type, DateTime last, int intervalDays)
    {
        var s = MaintStatus(last, intervalDays, x.Cfg, x.Now);
        x.Open.TryGetValue((device, type), out var a);
        var detail = $"{Describe(type)} {(s.DaysLeft >= 0 ? $"due in {s.DaysLeft} day(s)" : $"overdue by {-s.DaysLeft} day(s)")} (due {s.Due:yyyy-MM-dd})";
        if (s.Status == AlertStatus.Normal)
        {
            if (a is not null) { x.Open.Remove((device, type)); a.Status = AlertStatus.Resolved; a.ResolvedAt = x.Now; Event(x, a, AlertStatus.Resolved, "No longer due"); x.ToNotify.Add((a, AlertStatus.Resolved)); x.Resolved++; }
            return;
        }
        if (a is null)
        {
            a = new Alert { DeviceCode = device, Category = AlertCategory.Maintenance, AlertType = type, Status = s.Status, StartedAt = x.Now, LastSeenAt = x.Now, WarningAt = x.Now, CriticalAt = s.Status == AlertStatus.Critical ? x.Now : null, Detail = detail };
            db.Alerts.Add(a); x.Open[(device, type)] = a; Event(x, a, s.Status, detail); x.ToNotify.Add((a, s.Status)); x.Opened++;
            return;
        }
        a.LastSeenAt = x.Now; a.Detail = detail;
        if (s.Status == AlertStatus.Critical && a.Status != AlertStatus.Critical) { a.Status = AlertStatus.Critical; a.CriticalAt = x.Now; Event(x, a, AlertStatus.Critical, detail); x.ToNotify.Add((a, AlertStatus.Critical)); x.Escalated++; }
        else if (a.LastNotifiedAt is { } n && (x.Now - n).TotalDays >= x.Cfg.MaintenanceRepeatDays) { Event(x, a, a.Status, "Reminder: " + detail); x.ToNotify.Add((a, a.Status)); }
    }

    /// <summary>One evaluation pass over all active devices. Runs every few minutes in the background; the Super Admin can also trigger it.</summary>
    public Task<EvaluateResultDto> EvaluateAsOfAsync(DateTime? asOf, CancellationToken ct)
    {
        if (asOf is not null && !_o.AllowAsOf) throw ApiException.BadRequest("Evaluating as of another time is not enabled on this server.", "validation_failed");
        return EvaluateAsync(asOf is { } t ? (t.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(t, DateTimeKind.Utc) : t.ToUniversalTime()) : DateTime.UtcNow, ct);
    }

    public async Task<EvaluateResultDto> EvaluateAsync(DateTime utcNow, CancellationToken ct)
    {
        var cfg = await ConfigAsync(ct);
        var ist = utcNow.AddMinutes(_o.UtcOffsetMinutes);
        var devices = await db.Devices.AsNoTracking().Where(d => d.IsActive).Select(d => new { d.DeviceId, d.CreatedAt }).ToListAsync(ct);
        var open = (await db.Alerts.Where(a => a.Status != AlertStatus.Resolved).ToListAsync(ct)).ToDictionary(a => (a.DeviceCode, a.AlertType));
        var maint = (await db.DeviceMaintenances.AsNoTracking().ToListAsync(ct)).ToDictionary(m => m.DeviceCode);
        var x = new Ctx { Cfg = cfg, Now = utcNow, Open = open };

        // readings: the baseline window (previous N days up to the recent window) and the recent window, one grouped query each
        var baseFrom = ist.AddDays(-cfg.BaselineDays); var recentFrom = ist.AddMinutes(-cfg.RecentWindowMinutes);
        async Task<Dictionary<string, Stats>> Window(DateTime from, DateTime to) =>
            (await db.ManipulatedSensorData.AsNoTracking().Where(s => s.RecordedAt >= from && s.RecordedAt < to).GroupBy(s => s.DeviceCode)
                .Select(g => new { g.Key, N = g.Count(), Aqi = g.Average(s => (double?)s.Aqi), Temp = g.Average(s => (double?)(s.OuterTemperature ?? s.Temperature)) }).ToListAsync(ct))
            .ToDictionary(r => r.Key, r => new Stats(r.N, r.Aqi, r.Temp));
        var baseline = await Window(baseFrom, recentFrom); var recent = await Window(recentFrom, ist.AddMinutes(1));
        var last = (await db.ManipulatedSensorData.AsNoTracking().Where(s => s.RecordedAt >= ist.AddDays(-2)).GroupBy(s => s.DeviceCode).Select(g => new { g.Key, At = g.Max(s => s.RecordedAt) }).ToListAsync(ct)).ToDictionary(r => r.Key, r => r.At);
        // sensors: values received per sensor in the last N minutes (a device that sends readings but no value from one sensor = that sensor stopped)
        var sensorFrom = ist.AddMinutes(-cfg.SensorNoDataMinutes);
        var sensorWin = (await db.ManipulatedSensorData.AsNoTracking().Where(s => s.RecordedAt >= sensorFrom && s.RecordedAt < ist.AddMinutes(1)).GroupBy(s => s.DeviceCode).Select(g => new
        {
            g.Key, N = g.Count(), Pm25 = g.Count(s => s.Pm25 != null), Pm10 = g.Count(s => s.Pm10 != null), No2 = g.Count(s => s.No2Ppm != null), So2 = g.Count(s => s.So2Ppm != null), Co = g.Count(s => s.CoPpm != null),
            Tvoc = g.Count(s => s.TvocPpb != null), Hum = g.Count(s => s.Humidity != null), Temp = g.Count(s => s.Temperature != null), OutT = g.Count(s => s.OuterTemperature != null), OutH = g.Count(s => s.OuterHumidity != null),
        }).ToListAsync(ct)).ToDictionary(r => r.Key);
        var hourMissing = (await db.ManipulatedSensorData.AsNoTracking().Where(s => s.RecordedAt >= ist.AddHours(-1)).GroupBy(s => s.DeviceCode)
            .Select(g => new { g.Key, N = g.Count(), Missing = g.Count(s => s.OuterTemperature == null || s.OuterHumidity == null) }).ToListAsync(ct)).ToDictionary(r => r.Key, r => r);

        foreach (var d in devices)
        {
            var m = maint.GetValueOrDefault(d.DeviceId);
            Maintenance(x, d.DeviceId, AlertType.FilterReplacement, m?.FilterChangedAt ?? d.CreatedAt, cfg.FilterIntervalDays);
            Maintenance(x, d.DeviceId, AlertType.BinCleaning, m?.BinCleanedAt ?? d.CreatedAt, cfg.BinIntervalDays);

            // machine errors: reported at once (Warning), Critical after the same long limit as the other alerts
            var seen = last.TryGetValue(d.DeviceId, out var lastAt);
            var hasHistory = seen || await db.ManipulatedSensorData.AnyAsync(s => s.DeviceCode == d.DeviceId, ct);
            if (hasHistory)
            {
                var offline = !seen || (ist - lastAt).TotalMinutes >= cfg.OfflineAfterMinutes;
                Track(x, d.DeviceId, AlertCategory.MachineError, AlertType.DeviceOffline, offline, seen ? $"No reading since {lastAt:yyyy-MM-dd HH:mm} (IST)" : "No reading in the last 2 days", null, null, 0, cfg.CriticalAfterHours);
                var hm = hourMissing.GetValueOrDefault(d.DeviceId);
                var outerBad = hm is not null && hm.N >= 10 && hm.Missing * 100.0 / hm.N >= cfg.OuterMissingPercent;
                var sw = sensorWin.GetValueOrDefault(d.DeviceId);
                var missing = new List<string>();
                if (sw is not null && sw.N >= 3)
                {
                    var counts = new (string Name, int Count)[] { ("PM2.5", sw.Pm25), ("PM10", sw.Pm10), ("NO₂", sw.No2), ("SO₂", sw.So2), ("CO", sw.Co), ("TVOC", sw.Tvoc), ("Humidity", sw.Hum), ("Temperature", sw.Temp), ("Outer temperature", sw.OutT), ("Outer humidity", sw.OutH) };
                    if (counts.Any(c => c.Count > 0)) missing = counts.Where(c => c.Count == 0).Select(c => c.Name).ToList();      // only when the device itself is delivering
                }
                TrackSensors(x, d.DeviceId, missing, cfg);
                Track(x, d.DeviceId, AlertCategory.MachineError, AlertType.OuterSensorFailure, outerBad, hm is null ? "" : $"{hm.Missing} of {hm.N} readings in the last hour miss the outer temperature or humidity", hm is null ? null : (decimal)(hm.Missing * 100.0 / Math.Max(1, hm.N)), cfg.OuterMissingPercent, 0, cfg.CriticalAfterHours);
            }

            // abnormal readings against the previous N-day average (needs enough history and recent data; offline devices are a machine error, not an abnormal reading)
            var b = baseline.GetValueOrDefault(d.DeviceId); var r = recent.GetValueOrDefault(d.DeviceId);
            var judge = b is not null && r is not null && b.N >= cfg.MinBaselineSamples && r.N >= 3;
            if (judge)
            {
                var aqiBad = b!.Aqi is double ba && r!.Aqi is double ra && Math.Abs(ra - ba) > Math.Max(Math.Abs(ba) * (double)cfg.AqiChangePercent / 100.0, (double)cfg.AqiMinChange);
                var tempBad = b.Temp is double bt && r!.Temp is double rt && Math.Abs(rt - bt) > (double)cfg.TempChangeDegrees;
                Track(x, d.DeviceId, AlertCategory.AbnormalReading, AlertType.AqiAbnormal, aqiBad, $"AQI {r!.Aqi:0} vs {cfg.BaselineDays}-day average {b.Aqi:0}", (decimal?)r.Aqi, (decimal?)b.Aqi, cfg.WarningAfterHours, cfg.CriticalAfterHours);
                Track(x, d.DeviceId, AlertCategory.AbnormalReading, AlertType.TemperatureAbnormal, tempBad, $"Temperature {r.Temp:0.0} °C vs {cfg.BaselineDays}-day average {b.Temp:0.0} °C", (decimal?)r.Temp, (decimal?)b.Temp, cfg.WarningAfterHours, cfg.CriticalAfterHours);
            }
        }
        await db.SaveChangesAsync(ct);
        var emails = 0;
        foreach (var (alert, status) in x.ToNotify) emails += await NotifyAsync(alert, status, cfg, ct);
        if (x.Opened + x.Escalated + x.Resolved > 0) log.LogInformation("Alert evaluation: {Opened} opened, {Escalated} escalated, {Resolved} resolved, {Emails} email(s)", x.Opened, x.Escalated, x.Resolved, emails);
        return new EvaluateResultDto { Opened = x.Opened, Escalated = x.Escalated, Resolved = x.Resolved, Emails = emails };
    }

    // ------------------------------------------------------------------ emails

    private async Task<(int? Id, string? Email, string? Name, string? UserEmail, string? UserName)> OwnersAsync(string code, CancellationToken ct)
    {
        var a = await db.DeviceAssignments.AsNoTracking().Where(x => x.IsActive && x.Device.DeviceId == code)
            .Select(x => new { x.UserId, UserName = x.User.Name, UserEmail = x.User.Email, x.User.Role, x.User.ManagerId, ManagerRole = x.User.Manager != null ? x.User.Manager.Role : null, ManagerName = x.User.Manager != null ? x.User.Manager.Name : null, ManagerEmail = x.User.Manager != null ? x.User.Manager.Email : null })
            .FirstOrDefaultAsync(ct);
        if (a is null) return (null, null, null, null, null);
        if (a.Role == Roles.Admin) return (a.UserId, a.UserEmail, a.UserName, null, null);
        if (a.Role == Roles.User && a.ManagerRole == Roles.Admin) return (a.ManagerId, a.ManagerEmail, a.ManagerName, a.UserEmail, a.UserName);
        if (a.Role == Roles.User) return (null, null, null, a.UserEmail, a.UserName);
        return (null, null, null, null, null);
    }

    /// <summary>
    /// Emails one alert event. Recipients: Maintenance and Machine errors go to the Super Admin and the Admin of the device. Abnormal readings: a Warning goes to the Super Admin only; once Critical
    /// (more than the escalation time) it goes to the Super Admin, the Admin and the User; a resolution goes to everyone who was told. Returns how many emails were sent.
    /// </summary>
    private async Task<int> NotifyAsync(Alert a, string status, AlertConfiguration cfg, CancellationToken ct)
    {
        a.LastNotifiedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(CancellationToken.None);
        if (!cfg.EmailEnabled) return 0;
        var owners = await OwnersAsync(a.DeviceCode, ct);
        var devName = await db.Devices.AsNoTracking().Where(d => d.DeviceId == a.DeviceCode).Select(d => d.DeviceName).FirstOrDefaultAsync(ct) ?? a.DeviceCode;
        var escalated = a.CriticalAt != null;
        var toAdmin = a.Category != AlertCategory.AbnormalReading || escalated;
        var toUser = a.Category == AlertCategory.AbnormalReading && escalated;
        var catWord = a.Category switch { AlertCategory.Maintenance => "Maintenance", AlertCategory.MachineError => "Machine error", _ => "Abnormal reading" };
        var subject = $"[{status}] {catWord}: {Describe(a.AlertType)} - {a.DeviceCode}";
        var verb = status == AlertStatus.Resolved ? "has been resolved" : status == AlertStatus.Critical ? "is now CRITICAL" : "needs attention";
        string[] Body(string greet) => [greet, $"<b>{H(catWord)}</b> alert for device <b>{H(devName)}</b> ({H(a.DeviceCode)}) {verb}.", $"{H(Describe(a.AlertType))}" + (string.IsNullOrWhiteSpace(a.Detail) ? "" : $": {H(a.Detail)}"),
            a.Category == AlertCategory.Maintenance && status != AlertStatus.Resolved ? "After doing it, mark it as done in the panel (Alerts, Maintenance)." : "You can follow it in the panel under Alerts."];
        var sent = 0;
        foreach (var to in await notifier.SuperAdminEmailsAsync(ct)) { await notifier.SendAsync("Alert" + a.Category, Build(to, subject, $"{status}: {Describe(a.AlertType)}", Body("Hello Super Admin,")), null, null, ct); sent++; }
        if (toAdmin && owners.Email is not null) { await notifier.SendAsync("Alert" + a.Category, Build(owners.Email, subject, $"{status}: {Describe(a.AlertType)}", Body($"Hello {H(owners.Name)},")), null, owners.Id, ct); sent++; }
        if (toUser && owners.UserEmail is not null) { await notifier.SendAsync("Alert" + a.Category, Build(owners.UserEmail, subject, $"{status}: {Describe(a.AlertType)}", Body($"Hello {H(owners.UserName)},")), null, null, ct); sent++; }
        return sent;
    }
}

/// <summary>Runs the alert evaluation shortly after start-up and then every few minutes. Failures never stop the API.</summary>
public class AlertRunner(IServiceScopeFactory scopes, IOptions<AlertOptions> options, ILogger<AlertRunner> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var o = options.Value;
        if (!o.Enabled) { log.LogInformation("Alert evaluation is disabled."); return; }
        try { await Task.Delay(TimeSpan.FromSeconds(60), stop); } catch (OperationCanceledException) { return; }
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(Math.Max(1, o.IntervalMinutes)));
        do
        {
            try { using var scope = scopes.CreateScope(); await scope.ServiceProvider.GetRequiredService<AlertService>().EvaluateAsync(DateTime.UtcNow, stop); }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { return; }
            catch (Exception ex) { log.LogError(ex, "Alert evaluation failed."); }
        } while (await Next(timer, stop));
    }

    private static async Task<bool> Next(PeriodicTimer t, CancellationToken stop) { try { return await t.WaitForNextTickAsync(stop); } catch (OperationCanceledException) { return false; } }
}
