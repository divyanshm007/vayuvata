using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using VayuVata.Authorization;
using VayuVata.Data;
using VayuVata.DTOs.Shelly;
using VayuVata.Helpers;
using VayuVata.Models;

namespace VayuVata.Services;

public class ShellyOptions
{
    /// <summary>Cloud server used when a switch is registered without one.</summary>
    public string DefaultCloudHost { get; set; } = "shelly-277-eu.shelly.cloud";
    /// <summary>A switch's cloud host must end with one of these (stops the server being pointed at an arbitrary address).</summary>
    public string[] AllowedHostSuffixes { get; set; } = [".shelly.cloud"];
    /// <summary>Plain http and a port in the host are accepted ONLY when this is true. For automated tests against a fake cloud; never enable it on a real server.</summary>
    public bool AllowHttp { get; set; }
    /// <summary>The same switch cannot be commanded again within this many seconds (relay protection, double-click protection).</summary>
    public int MinSecondsBetweenCommands { get; set; } = 2;
    /// <summary>The Shelly Cloud allows about one request per second per account (auth key); more answers HTTP 429. Calls with the same key are spaced at least this many milliseconds apart.</summary>
    public int MinMillisecondsBetweenCloudCalls { get; set; } = 1100;
    /// <summary>A switch is never turned ON while the Shelly reports a protection error, or while its own temperature is at or above this (degrees C).</summary>
    public decimal MaxSwitchOnTemperatureC { get; set; } = 80;
    public ShellySchedulerOptions Scheduler { get; set; } = new();
}

public class ShellySchedulerOptions
{
    /// <summary>Runs the daily schedules. Off in Development so a laptop never switches a real device; on elsewhere.</summary>
    public bool Enabled { get; set; } = true;
    public int IntervalSeconds { get; set; } = 30;
    /// <summary>A scheduled ON / OFF still runs when this server was down at that moment, but only up to this many minutes late. Later than that it is skipped, so a restart or an outage never switches a device at a surprising time.</summary>
    public int CatchUpMinutes { get; set; } = 5;
    /// <summary>The schedule times are India time (UTC+5:30, no daylight saving).</summary>
    public int UtcOffsetMinutes { get; set; } = 330;
}

/// <summary>
/// Shelly smart switches linked to VayuVata devices. SuperAdmin registers/edits them and sees all; an Admin sees and switches only the
/// switches whose VayuVata device is assigned to them or to one of their Users. Commands go to the Shelly Cloud and are audited.
/// </summary>
public partial class ShellyService(VayuVataDbContext db, IHttpClientFactory http, IOptions<ShellyOptions> options, ILogger<ShellyService> log)
{
    private readonly ShellyOptions _o = options.Value;

    [GeneratedRegex("^[a-z0-9]{6,32}$")] private static partial Regex IdPattern();

    // ------------------------------------------------------------------ scope

    private IQueryable<ShellyDevice> Visible(CurrentUser c) =>
        c.IsSuperAdmin ? db.ShellyDevices
        : db.ShellyDevices.Where(s => s.IsActive && s.DeviceCode != null && db.DataDevices(c).Select(d => d.DeviceId).Contains(s.DeviceCode));

    private async Task<ShellyDevice> GetVisibleAsync(int id, CurrentUser c, CancellationToken ct) =>
        await Visible(c).FirstOrDefaultAsync(s => s.Id == id, ct) ?? throw ApiException.NotFound("Switch not found.");

    // ------------------------------------------------------------------- CRUD

    public async Task<List<ShellyDeviceDto>> ListAsync(CurrentUser c, CancellationToken ct)
    {
        var rows = await Visible(c).AsNoTracking().OrderBy(s => s.Name).Select(s => new
        {
            s.Id, s.Name, s.ShellyId, s.CloudHost, s.Channel, s.DeviceCode, DeviceName = s.Device != null ? s.Device.DeviceName : null,
            s.IsActive, s.AuthKey, s.CreatedAt,
            s.OverrideActive, s.OverrideSetAt, s.ScheduleEnabled, s.DailyOnTime, s.DailyOffTime, s.ConfigUpdatedAt,
            OverrideBy = db.Users.Where(u => u.Id == s.OverrideSetByUserId).Select(u => u.Name).FirstOrDefault(),
            UpdatedBy = db.Users.Where(u => u.Id == s.ConfigUpdatedByUserId).Select(u => u.Name).FirstOrDefault(),
            Last = s.Commands.OrderByDescending(x => x.At).Select(x => new { x.At, x.TurnOn, User = x.User != null ? x.User.Name : "Schedule (automatic)" }).FirstOrDefault(),
        }).ToListAsync(ct);
        return rows.Select(r => new ShellyDeviceDto
        {
            Id = r.Id, Name = r.Name, ShellyId = r.ShellyId, CloudHost = r.CloudHost, Channel = r.Channel, DeviceId = r.DeviceCode, DeviceName = r.DeviceName,
            IsActive = r.IsActive, CreatedAt = r.CreatedAt,
            AuthKeyHint = c.IsSuperAdmin ? Hint(r.AuthKey) : null,        // the full key is never returned; Admins get no hint at all
            LastCommandAt = r.Last?.At, LastCommandOn = r.Last?.TurnOn, LastCommandBy = r.Last?.User,
            OverrideActive = r.OverrideActive,
            CanControl = r.IsActive && (c.IsSuperAdmin || (c.IsAdmin && !r.OverrideActive)),
            Config = !c.IsSuperAdmin ? null : new ShellyConfigDto
            {
                ScheduleEnabled = r.ScheduleEnabled, DailyOnTime = Hm(r.DailyOnTime), DailyOffTime = Hm(r.DailyOffTime),
                OverrideActive = r.OverrideActive, OverrideSetAt = r.OverrideSetAt, OverrideBy = r.OverrideBy, UpdatedAt = r.ConfigUpdatedAt, UpdatedBy = r.UpdatedBy,
            },
        }).ToList();
    }

    private static string? Hm(TimeOnly? t) => t?.ToString("HH:mm");

    private static string Hint(string key) => key.Length <= 4 ? "••••" : "••••" + key[^4..];

    public async Task<ShellyDeviceDto> CreateAsync(CreateShellyRequest req, CurrentUser c, CancellationToken ct)
    {
        if (!c.IsSuperAdmin) throw ApiException.Forbidden();
        var entity = new ShellyDevice
        {
            Name = CleanName(req.Name), ShellyId = CleanShellyId(req.ShellyId), AuthKey = CleanKey(req.AuthKey, required: true)!,
            CloudHost = NormalizeHost(req.CloudHost), Channel = CleanChannel(req.Channel),
        };
        entity.DeviceCode = await ResolveDeviceCodeAsync(req.DeviceId, null, ct);
        db.ShellyDevices.Add(entity);
        await SaveUniqueAsync(ct);
        log.LogInformation("AUDIT shelly switch {ShellyId} registered by SuperAdmin {CallerId} (linked to {Device})", entity.ShellyId, c.Id, entity.DeviceCode ?? "-");
        return (await ListAsync(c, ct)).First(x => x.Id == entity.Id);
    }

    public async Task<ShellyDeviceDto> UpdateAsync(int id, UpdateShellyRequest req, CurrentUser c, CancellationToken ct)
    {
        if (!c.IsSuperAdmin) throw ApiException.Forbidden();
        var s = await db.ShellyDevices.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw ApiException.NotFound("Switch not found.");
        s.Name = CleanName(req.Name);
        s.CloudHost = NormalizeHost(req.CloudHost);
        s.Channel = CleanChannel(req.Channel);
        s.IsActive = req.IsActive;
        s.DeviceCode = await ResolveDeviceCodeAsync(req.DeviceId, s.Id, ct);
        var newKey = CleanKey(req.AuthKey, required: false);
        if (newKey is not null) s.AuthKey = newKey;
        s.UpdatedAt = DateTime.UtcNow;
        await SaveUniqueAsync(ct);
        log.LogInformation("AUDIT shelly switch {ShellyId} updated by SuperAdmin {CallerId} (linked to {Device}, active {Active}, key replaced {KeyChanged})",
            s.ShellyId, c.Id, s.DeviceCode ?? "-", s.IsActive, newKey is not null);
        return (await ListAsync(c, ct)).First(x => x.Id == s.Id);
    }

    /// <summary>Permanently removes a switch and its command history (SuperAdmin only). Needs DELETE on dbo.ShellyDevices and dbo.ShellyCommands only.</summary>
    public async Task DeleteAsync(int id, CurrentUser c, CancellationToken ct)
    {
        if (!c.IsSuperAdmin) throw ApiException.Forbidden();
        var s = await db.ShellyDevices.AsNoTracking().Where(x => x.Id == id).Select(x => new { x.Id, x.ShellyId, x.DeviceCode }).FirstOrDefaultAsync(ct)
                ?? throw ApiException.NotFound("Switch not found.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var commands = await db.ShellyCommands.Where(x => x.ShellyDeviceId == id).ExecuteDeleteAsync(ct);   // the history references the switch, so it goes first
        await db.ShellyDevices.Where(x => x.Id == id).ExecuteDeleteAsync(ct);
        await tx.CommitAsync(ct);
        log.LogInformation("AUDIT shelly switch {ShellyId} (linked to {Device}) DELETED by SuperAdmin {CallerId}, with {Commands} history rows", s.ShellyId, s.DeviceCode ?? "-", c.Id, commands);
    }

    private async Task SaveUniqueAsync(CancellationToken ct)
    {
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (SqlErrors.IsUniqueViolation(ex))
        {
            throw ApiException.Conflict("This Shelly device id is already registered, or that VayuVata device already has a switch.", "shelly_exists");
        }
    }

    private static string CleanName(string? v)
    {
        var n = (v ?? "").Trim();
        if (n.Length is < 1 or > 150) throw ApiException.BadRequest("Name is required (1-150 characters).", "validation_failed");
        return n;
    }

    private static string CleanShellyId(string? v)
    {
        var id = (v ?? "").Trim().ToLowerInvariant().Replace(":", "").Replace("-", "");
        if (!IdPattern().IsMatch(id)) throw ApiException.BadRequest("Shelly device id must be 6-32 letters or digits, e.g. d0cf13cb84d4.", "validation_failed");
        return id;
    }

    private static string? CleanKey(string? v, bool required)
    {
        var k = (v ?? "").Trim();
        if (k.Length == 0) return required ? throw ApiException.BadRequest("The Shelly Cloud auth key is required.", "validation_failed") : null;
        if (k.Length is < 8 or > 300 || k.Any(char.IsWhiteSpace)) throw ApiException.BadRequest("The auth key must be 8-300 characters without spaces.", "validation_failed");
        return k;
    }

    private static byte CleanChannel(byte ch) => ch <= 3 ? ch : throw ApiException.BadRequest("Channel must be 0-3.", "validation_failed");

    /// <summary>Only a Shelly Cloud host is accepted (https, no path, no port) so the server can never be aimed at another address.</summary>
    private string NormalizeHost(string? v)
    {
        var h = (string.IsNullOrWhiteSpace(v) ? _o.DefaultCloudHost : v).Trim().ToLowerInvariant();
        foreach (var prefix in new[] { "https://", "http://" }) if (h.StartsWith(prefix)) h = h[prefix.Length..];
        h = h.TrimEnd('/');
        var hostOnly = h;
        var hasPort = false;
        var colon = h.IndexOf(':');
        if (colon >= 0) { hostOnly = h[..colon]; hasPort = true; }
        var ok = hostOnly.Length > 0 && !h.Contains('/') && !h.Contains('@') && !h.Contains('?') && Uri.CheckHostName(hostOnly) == UriHostNameType.Dns
                 && _o.AllowedHostSuffixes.Any(suffix => hostOnly.EndsWith(suffix, StringComparison.Ordinal) || hostOnly == suffix.TrimStart('.'))
                 && (!hasPort || _o.AllowHttp);
        if (!ok) throw ApiException.BadRequest("Cloud server must be a Shelly Cloud host, for example shelly-277-eu.shelly.cloud.", "validation_failed");
        return h;
    }

    private async Task<string?> ResolveDeviceCodeAsync(string? deviceId, int? exceptShellyId, CancellationToken ct)
    {
        var code = deviceId?.Trim();
        if (string.IsNullOrEmpty(code)) return null;
        var device = await db.Devices.AsNoTracking().Where(d => d.DeviceId == code).Select(d => d.DeviceId).FirstOrDefaultAsync(ct)
                     ?? throw ApiException.BadRequest("That VayuVata device does not exist.", "device_not_found");
        if (await db.ShellyDevices.AnyAsync(s => s.DeviceCode == device && s.Id != exceptShellyId, ct))
            throw ApiException.Conflict("That VayuVata device already has a switch.", "shelly_exists");
        return device;
    }

    // ----------------------------------------------------------- cloud calls

    private string Base(ShellyDevice s) => (_o.AllowHttp ? "http://" : "https://") + s.CloudHost;

    private static string? ShellyError(JsonElement root)
    {
        if (!root.TryGetProperty("errors", out var e)) return null;
        return e.ValueKind switch
        {
            JsonValueKind.Array => string.Join(", ", e.EnumerateArray().Select(x => x.ToString())),
            JsonValueKind.Object => string.Join(", ", e.EnumerateObject().Select(x => $"{x.Name}: {x.Value}")),
            _ => e.ToString(),
        };
    }

    // One request per second per Shelly account is the cloud's limit. Calls that share an auth key wait their turn here instead of being refused with HTTP 429.
    private static readonly ConcurrentDictionary<string, (SemaphoreSlim Gate, long[] LastTick)> Pacing = new();

    private async Task PaceAsync(string authKey, CancellationToken ct)
    {
        var (gate, last) = Pacing.GetOrAdd(authKey, _ => (new SemaphoreSlim(1, 1), new long[1]));
        await gate.WaitAsync(ct);
        try
        {
            var wait = _o.MinMillisecondsBetweenCloudCalls - (Environment.TickCount64 - last[0]);
            if (wait > 0) await Task.Delay((int)Math.Min(wait, 3000), ct);
            last[0] = Environment.TickCount64;
        }
        finally { gate.Release(); }
    }

    private static string Snippet(string text)
    {
        var t = (text ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
        return t.Length == 0 ? "(empty answer)" : t.Length > 160 ? t[..160] + "..." : t;
    }

    /// <summary>
    /// Sends one request to the Shelly Cloud and returns its JSON answer. Success = isok is true (or, when the answer has no isok at all, it carries no error).
    /// The real cloud answers a SUCCESSFUL set-switch command with an EMPTY body (HTTP success, no JSON), so <paramref name="allowEmptySuccess"/> accepts that (returns null)
    /// for commands; a status read still needs JSON. Any other non-JSON answer is reported WITH what was received, instead of a vague "malformed request".
    /// Errors (wrong key, unknown device) always come back as JSON with isok=false and are reported as such.
    /// </summary>
    private async Task<JsonDocument?> CloudAsync(string authKey, Func<HttpClient, Task<HttpResponseMessage>> call, bool allowEmptySuccess, CancellationToken ct)
    {
        HttpResponseMessage resp;
        for (var attempt = 1; ; attempt++)
        {
            await PaceAsync(authKey, ct);
            try { resp = await call(http.CreateClient("shelly")); break; }
            // A dropped or stale connection: try once more (both calls are safe to repeat: "set output to ON" twice changes nothing).
            catch (HttpRequestException) when (attempt == 1) { continue; }
            catch (HttpRequestException) { throw new ApiException(502, "shelly_unreachable", "The Shelly Cloud could not be reached."); }
            catch (TaskCanceledException) when (!ct.IsCancellationRequested) { throw new ApiException(502, "shelly_timeout", "The Shelly Cloud did not answer in time."); }
        }
        using (resp)
        {
            var text = await resp.Content.ReadAsStringAsync(ct);
            if ((int)resp.StatusCode == 429) throw ApiException.TooManyRequests("The Shelly Cloud is limiting requests (about 1 per second). Wait a few seconds, then press Refresh.", "shelly_rate_limited");
            JsonDocument? doc = null;
            try { if (!string.IsNullOrWhiteSpace(text)) doc = JsonDocument.Parse(text); } catch (JsonException) { /* reported below with the text */ }
            var root = doc?.RootElement;
            var rootOk = root is { ValueKind: JsonValueKind.Object };
            if (!resp.IsSuccessStatusCode)
            {
                var why = rootOk ? ShellyError(root!.Value) : null;
                doc?.Dispose();
                throw new ApiException(502, "shelly_error", $"The Shelly Cloud answered HTTP {(int)resp.StatusCode}: {why ?? Snippet(text)}");
            }
            if (allowEmptySuccess && string.IsNullOrWhiteSpace(text)) return null;
            if (!rootOk)
            {
                doc?.Dispose();
                throw new ApiException(502, "shelly_bad_reply", $"The Shelly Cloud sent an answer this server could not read: {Snippet(text)}");
            }
            var hasIsOk = root!.Value.TryGetProperty("isok", out var ok);
            var accepted = hasIsOk ? ok.ValueKind == JsonValueKind.True : ShellyError(root.Value) is null && !root.Value.TryGetProperty("error", out _);
            if (!accepted)
            {
                var msg = ShellyError(root.Value) ?? (root.Value.TryGetProperty("error", out var er) ? er.ToString() : null) ?? "The Shelly Cloud rejected the request (check the device id and auth key).";
                doc!.Dispose();
                throw new ApiException(502, "shelly_rejected", msg);
            }
            return doc!;
        }
    }

    private static decimal? Dec(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDecimal(out var d) ? d : null;

    /// <summary>Reads the live state from the Shelly Cloud (all fields; callers decide what a role may see).</summary>
    private async Task<ShellyStatusDto> ReadStatusAsync(ShellyDevice s, CancellationToken ct)
    {
        var url = $"{Base(s)}/device/status?id={Uri.EscapeDataString(s.ShellyId)}&auth_key={Uri.EscapeDataString(s.AuthKey)}";
        using var doc = await CloudAsync(s.AuthKey, cl => cl.GetAsync(url, ct), allowEmptySuccess: false, ct);
        var dto = new ShellyStatusDto { Id = s.Id, CheckedAt = DateTime.UtcNow };
        if (doc is null || !doc.RootElement.TryGetProperty("data", out var data)) return dto;
        dto.Online = data.TryGetProperty("online", out var on) && on.ValueKind == JsonValueKind.True;
        if (!data.TryGetProperty("device_status", out var ds)) return dto;
        if (ds.TryGetProperty($"switch:{s.Channel}", out var sw))
        {
            if (sw.TryGetProperty("output", out var o) && o.ValueKind is JsonValueKind.True or JsonValueKind.False) dto.On = o.GetBoolean();
            dto.PowerW = Dec(sw, "apower"); dto.VoltageV = Dec(sw, "voltage"); dto.CurrentA = Dec(sw, "current");
            if (sw.TryGetProperty("temperature", out var t)) dto.TemperatureC = Dec(t, "tC");
            if (sw.TryGetProperty("aenergy", out var ae)) dto.EnergyTotalWh = Dec(ae, "total");
            if (sw.TryGetProperty("errors", out var er) && er.ValueKind == JsonValueKind.Array)
                dto.Errors = er.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList();
        }
        if (ds.TryGetProperty("wifi", out var w))
        {
            dto.WifiRssi = Dec(w, "rssi") is { } r ? (int)r : null;
            dto.Ssid = w.TryGetProperty("ssid", out var ss) && ss.ValueKind == JsonValueKind.String ? ss.GetString() : null;
        }
        dto.CloudUpdatedAt = ds.TryGetProperty("_updated", out var up) && up.ValueKind == JsonValueKind.String ? up.GetString() : null;
        return dto;
    }

    /// <summary>Everyone who can see the switch sees ON / OFF. Power, voltage, current, temperature, Wi-Fi and errors are for the SuperAdmin only; they are removed here, on the server.</summary>
    public async Task<ShellyStatusDto> StatusAsync(int id, CurrentUser c, CancellationToken ct)
    {
        var s = await GetVisibleAsync(id, c, ct);
        var dto = await ReadStatusAsync(s, ct);
        if (!c.IsSuperAdmin)
        {
            dto.PowerW = dto.VoltageV = dto.CurrentA = dto.TemperatureC = dto.EnergyTotalWh = null;
            dto.WifiRssi = null; dto.Ssid = null; dto.CloudUpdatedAt = null; dto.Errors = [];
        }
        return dto;
    }

    // ------------------------------------------------------------- switching

    public const string ControlLockedMessage = "Device control is currently managed by Super Admin.";

    /// <summary>Manual ON / OFF. SuperAdmin: always. Admin: only while the SuperAdmin override is off. User: never (view only).</summary>
    public async Task<SwitchResultDto> SwitchAsync(int id, bool on, CurrentUser c, CancellationToken ct)
    {
        if (!c.IsSuperAdmin && !c.IsAdmin) throw ApiException.Forbidden();
        var s = await GetVisibleAsync(id, c, ct);
        if (!s.IsActive) throw ApiException.Conflict("This switch is deactivated.", "shelly_inactive");
        if (!c.IsSuperAdmin && s.OverrideActive) throw new ApiException(403, "control_locked", ControlLockedMessage);
        return await SwitchCoreAsync(s, on, c.Id, "Manual", ct);
    }

    /// <summary>Sends one ON / OFF to the Shelly Cloud and records it (who, when, result). Used by manual control and by the daily schedule.</summary>
    private async Task<SwitchResultDto> SwitchCoreAsync(ShellyDevice s, bool on, int? userId, string source, CancellationToken ct)
    {
        var last = await db.ShellyCommands.Where(x => x.ShellyDeviceId == s.Id).OrderByDescending(x => x.At).Select(x => (DateTime?)x.At).FirstOrDefaultAsync(ct);
        if (last is { } l && (DateTime.UtcNow - l).TotalSeconds < _o.MinSecondsBetweenCommands)
            throw ApiException.TooManyRequests($"Wait {_o.MinSecondsBetweenCommands} seconds between commands to the same switch.", "shelly_cooldown");

        string? error = null;
        int errorStatus = 502; string errorCode = "shelly_failed";
        try
        {
            // Electrical / thermal protection: never switch ON while the Shelly reports a protection error or is too hot.
            if (on)
            {
                ShellyStatusDto? st = null;
                try { st = await ReadStatusAsync(s, ct); } catch (ApiException) { /* unreadable: the switch command below reports the real problem */ }
                if (st is not null && (st.Errors.Count > 0 || st.TemperatureC >= _o.MaxSwitchOnTemperatureC))
                {
                    var why = st.Errors.Count > 0 ? "protection error: " + string.Join(", ", st.Errors) : $"temperature {st.TemperatureC:0.#} °C is too high";
                    throw new ApiException(409, "shelly_protection", $"Not switched ON - the Shelly reports a {why}.");
                }
            }
            var body = JsonSerializer.Serialize(new { id = s.ShellyId, channel = (int)s.Channel, on, auth_key = s.AuthKey });
            using var doc = await CloudAsync(s.AuthKey, cl => cl.PostAsync($"{Base(s)}/v2/devices/api/set/switch", new StringContent(body, new System.Net.Http.Headers.MediaTypeHeaderValue("application/json")), ct), allowEmptySuccess: true, ct);
        }
        catch (ApiException ex) { error = ex.Message; if (ex.Code == "shelly_protection") { errorStatus = 409; errorCode = ex.Code; } }

        db.ShellyCommands.Add(new ShellyCommand { ShellyDeviceId = s.Id, UserId = userId, Source = source, TurnOn = on, Succeeded = error is null, Error = error is null ? null : error[..Math.Min(300, error.Length)] });
        await db.SaveChangesAsync(CancellationToken.None);
        log.LogInformation("AUDIT shelly switch {ShellyId} ({Device}) turned {State} by {Who} [{Source}]: {Result}", s.ShellyId, s.DeviceCode ?? "-", on ? "ON" : "OFF", userId is null ? "schedule" : "user " + userId, source, error ?? "ok");

        if (error is not null) throw new ApiException(errorStatus, errorCode, error);
        return new SwitchResultDto { Ok = true, On = on, Message = on ? "Turned ON." : "Turned OFF." };
    }

    public async Task<List<ShellyCommandDto>> CommandsAsync(int id, CurrentUser c, CancellationToken ct)
    {
        if (!c.IsSuperAdmin && !c.IsAdmin) throw ApiException.Forbidden();
        var s = await GetVisibleAsync(id, c, ct);
        return await db.ShellyCommands.AsNoTracking().Where(x => x.ShellyDeviceId == s.Id).OrderByDescending(x => x.At).Take(20)
            .Select(x => new ShellyCommandDto { Id = x.Id, TurnOn = x.TurnOn, Succeeded = x.Succeeded, Error = x.Error, UserName = x.User != null ? x.User.Name : "Schedule (automatic)", Source = x.Source, At = x.At }).ToListAsync(ct);
    }

    // ----------------------------------------------------- device configuration

    private static TimeOnly? ParseTime(string? v, string label)
    {
        if (string.IsNullOrWhiteSpace(v)) return null;
        if (TimeOnly.TryParseExact(v.Trim(), ["HH:mm", "H:mm", "HH:mm:ss"], System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var t)) return new TimeOnly(t.Hour, t.Minute);
        throw ApiException.BadRequest($"{label} must be a time like 08:30.", "validation_failed");
    }

    /// <summary>SuperAdmin only: the daily ON / OFF time and the override of ONE switch. Other switches are not affected.</summary>
    public async Task<ShellyDeviceDto> UpdateConfigAsync(int id, UpdateShellyConfigRequest req, CurrentUser c, CancellationToken ct)
    {
        if (!c.IsSuperAdmin) throw ApiException.Forbidden();
        var s = await db.ShellyDevices.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw ApiException.NotFound("Switch not found.");
        var on = ParseTime(req.DailyOnTime, "Daily ON time");
        var off = ParseTime(req.DailyOffTime, "Daily OFF time");
        if (req.ScheduleEnabled)
        {
            if (on is null || off is null) throw ApiException.BadRequest("Set both the daily ON time and the daily OFF time, or turn the schedule off.", "validation_failed");
            if (on == off) throw ApiException.BadRequest("The ON time and the OFF time must be different.", "validation_failed");
        }
        // A changed time may run today again (e.g. moved to a later time); an unchanged one keeps its "already ran today" mark.
        if (on != s.DailyOnTime) s.LastScheduleOnDate = null;
        if (off != s.DailyOffTime) s.LastScheduleOffDate = null;
        s.ScheduleEnabled = req.ScheduleEnabled; s.DailyOnTime = on; s.DailyOffTime = off;
        if (req.OverrideActive != s.OverrideActive) { s.OverrideActive = req.OverrideActive; s.OverrideSetAt = DateTime.UtcNow; s.OverrideSetByUserId = c.Id; }
        s.ConfigUpdatedAt = DateTime.UtcNow; s.ConfigUpdatedByUserId = c.Id;
        await db.SaveChangesAsync(ct);
        log.LogInformation("AUDIT shelly switch {ShellyId} configuration by SuperAdmin {CallerId}: schedule {Enabled} ON {On} OFF {Off}, override {Override}",
            s.ShellyId, c.Id, s.ScheduleEnabled, Hm(on) ?? "-", Hm(off) ?? "-", s.OverrideActive);
        return (await ListAsync(c, ct)).First(x => x.Id == s.Id);
    }

    // ------------------------------------------------------------- daily schedule

    private bool IsDue(TimeOnly now, TimeOnly at, DateOnly? lastRun, DateOnly today) =>
        lastRun != today && now >= at && (now.ToTimeSpan() - at.ToTimeSpan()).TotalMinutes <= _o.Scheduler.CatchUpMinutes;

    /// <summary>
    /// Runs the daily ON / OFF of every switch whose schedule is enabled. Called every few seconds by <see cref="ShellyScheduleRunner"/>.
    /// Each event runs once a day, at most <c>CatchUpMinutes</c> late; a switch under SuperAdmin override is skipped; nothing runs for a stale time after a restart.
    /// A failed command is recorded and tried again on the next call until the catch-up window closes.
    /// </summary>
    public async Task RunScheduleAsync(DateTime utcNow, CancellationToken ct)
    {
        var ist = utcNow.AddMinutes(_o.Scheduler.UtcOffsetMinutes);
        var today = DateOnly.FromDateTime(ist);
        var now = TimeOnly.FromDateTime(ist);
        var rows = await db.ShellyDevices.Where(s => s.IsActive && s.ScheduleEnabled && !s.OverrideActive && s.DailyOnTime != null && s.DailyOffTime != null).ToListAsync(ct);
        foreach (var s in rows)
        {
            if (ct.IsCancellationRequested) return;
            var onDue = IsDue(now, s.DailyOnTime!.Value, s.LastScheduleOnDate, today);
            var offDue = IsDue(now, s.DailyOffTime!.Value, s.LastScheduleOffDate, today);
            if (!onDue && !offDue) continue;
            // If both are due (very close times) only the later one matters: it decides the final state.
            var turnOn = onDue && (!offDue || s.DailyOnTime > s.DailyOffTime);
            try
            {
                await SwitchCoreAsync(s, turnOn, null, "Schedule", ct);
                if (turnOn) s.LastScheduleOnDate = today; else s.LastScheduleOffDate = today;
                if (onDue && offDue) { s.LastScheduleOnDate = today; s.LastScheduleOffDate = today; }
                await db.SaveChangesAsync(CancellationToken.None);
            }
            catch (ApiException ex) { log.LogWarning("Scheduled {State} of shelly switch {ShellyId} failed: {Message}", turnOn ? "ON" : "OFF", s.ShellyId, ex.Message); }
        }
    }
}

/// <summary>Background loop that applies the daily schedules. Does nothing when <c>Shelly:Scheduler:Enabled</c> is false (Development).</summary>
public class ShellyScheduleRunner(IServiceScopeFactory scopes, IOptions<ShellyOptions> options, ILogger<ShellyScheduleRunner> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var o = options.Value.Scheduler;
        if (!o.Enabled) { log.LogInformation("Shelly schedule runner is disabled."); return; }
        log.LogInformation("Shelly schedule runner started (every {Seconds}s, catch-up {Minutes} min).", o.IntervalSeconds, o.CatchUpMinutes);
        try { await Task.Delay(TimeSpan.FromSeconds(20), stop); } catch (OperationCanceledException) { return; }
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(5, o.IntervalSeconds)));
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<ShellyService>().RunScheduleAsync(DateTime.UtcNow, stop);
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { return; }
            catch (Exception ex) { log.LogError(ex, "Shelly schedule run failed."); }
        } while (await WaitAsync(timer, stop));
    }

    private static async Task<bool> WaitAsync(PeriodicTimer t, CancellationToken stop) { try { return await t.WaitForNextTickAsync(stop); } catch (OperationCanceledException) { return false; } }
}
