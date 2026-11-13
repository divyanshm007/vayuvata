using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using VayuVata.Data;
using VayuVata.DTOs.Devices;
using VayuVata.Helpers;
using VayuVata.Models;

namespace VayuVata.Services;

public class LocationNameOptions
{
    /// <summary>Looks up place names for device positions (OpenStreetMap Nominatim). When false the panel shows coordinates only.</summary>
    public bool Enabled { get; set; } = true;
    public string BaseUrl { get; set; } = "https://nominatim.openstreetmap.org";
    /// <summary>Nominatim's usage policy requires an identifying User-Agent. No personal data belongs here.</summary>
    public string UserAgent { get; set; } = "VayuVata-LIVVAir/1.0";
    public int IntervalMinutes { get; set; } = 5;
    /// <summary>The public Nominatim server allows at most one request per second.</summary>
    public int MinMillisecondsBetweenCalls { get; set; } = 1100;
}

/// <summary>
/// Place names for the last known position of each device. Names are looked up once per spot by a background loop and stored in dbo.LocationNames;
/// reading a device list only joins the stored names, it never calls the map service. Only the coordinates of the device are sent to the service.
/// </summary>
public class LocationNameService(VayuVataDbContext db, IHttpClientFactory http, IOptions<LocationNameOptions> options, ILogger<LocationNameService> log)
{
    private readonly LocationNameOptions _o = options.Value;
    private static readonly ConcurrentDictionary<(decimal, decimal), DateTime> LastFailure = new();

    public static decimal Key(decimal v) => Math.Round(v, 4);

    /// <summary>Fills <c>Name</c> of each device's last location from the stored names (no external call).</summary>
    public async Task AttachAsync(IEnumerable<DeviceDto> devices, CancellationToken ct)
    {
        var locs = devices.Where(d => d.LastLocation is not null).Select(d => d.LastLocation!).ToList();
        if (locs.Count == 0) return;
        var lats = locs.Select(l => Key(l.Latitude)).Distinct().ToList();
        var rows = await db.LocationNames.AsNoTracking().Where(n => lats.Contains(n.LatKey)).ToListAsync(ct);
        var map = rows.ToDictionary(n => (n.LatKey, n.LonKey), n => n.Name);
        foreach (var l in locs) if (map.TryGetValue((Key(l.Latitude), Key(l.Longitude)), out var name)) l.Name = name;
    }

    /// <summary>Looks up the names that are still missing for the newest position of every device. Returns how many were stored.</summary>
    public async Task<int> ResolveMissingAsync(CancellationToken ct)
    {
        if (!_o.Enabled) return 0;
        var latest = await db.Devices.AsNoTracking()
            .Select(d => db.GpsLocationData.Where(g => g.DeviceCode == d.DeviceId && g.HasFix && g.Latitude != null && g.Longitude != null)
                .OrderByDescending(g => g.RecordedAt).Select(g => new { Lat = g.Latitude!.Value, Lon = g.Longitude!.Value }).FirstOrDefault())
            .ToListAsync(ct);
        var wanted = latest.Where(x => x is not null).Select(x => (Lat: Key(x!.Lat), Lon: Key(x.Lon))).Distinct().ToList();
        if (wanted.Count == 0) return 0;
        var have = (await db.LocationNames.AsNoTracking().Select(n => new { n.LatKey, n.LonKey }).ToListAsync(ct)).Select(n => (n.LatKey, n.LonKey)).ToHashSet();
        var stored = 0;
        foreach (var w in wanted.Where(w => !have.Contains((w.Lat, w.Lon))))
        {
            if (ct.IsCancellationRequested) break;
            if (LastFailure.TryGetValue(w, out var failedAt) && DateTime.UtcNow - failedAt < TimeSpan.FromMinutes(30)) continue;   // do not hammer the service for a spot it could not name
            var name = await LookupAsync(w.Lat, w.Lon, ct);
            if (name is null) { LastFailure[w] = DateTime.UtcNow; continue; }
            db.LocationNames.Add(new LocationName { LatKey = w.Lat, LonKey = w.Lon, Name = name });
            try { await db.SaveChangesAsync(ct); stored++; }
            catch (DbUpdateException ex) when (SqlErrors.IsUniqueViolation(ex)) { db.ChangeTracker.Clear(); }   // another instance stored it first
            await Task.Delay(_o.MinMillisecondsBetweenCalls, ct);
        }
        if (stored > 0) log.LogInformation("Stored {Count} place name(s) for device positions.", stored);
        return stored;
    }

    private async Task<string?> LookupAsync(decimal lat, decimal lon, CancellationToken ct)
    {
        try
        {
            var url = $"{_o.BaseUrl.TrimEnd('/')}/reverse?format=jsonv2&zoom=16&addressdetails=1&accept-language=en&lat={lat.ToString(System.Globalization.CultureInfo.InvariantCulture)}&lon={lon.ToString(System.Globalization.CultureInfo.InvariantCulture)}";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.UserAgent.ParseAdd(_o.UserAgent);
            using var resp = await http.CreateClient("nominatim").SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode) { log.LogWarning("Place name lookup answered HTTP {Status}.", (int)resp.StatusCode); return null; }
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
            return ShortName(doc.RootElement);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            if (ct.IsCancellationRequested) throw;
            log.LogWarning("Place name lookup failed: {Message}", ex.Message);
            return null;
        }
    }

    /// <summary>"Vasundhara, Ghaziabad, Uttar Pradesh": the area, the city or district, and the state (street details and the postcode are left out).</summary>
    public static string? ShortName(JsonElement root)
    {
        string? P(JsonElement a, params string[] keys)
        {
            foreach (var k in keys)
                if (a.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(v.GetString())) return v.GetString()!.Trim();
            return null;
        }
        string? name = null;
        if (root.TryGetProperty("address", out var a) && a.ValueKind == JsonValueKind.Object)
        {
            var parts = new[]
            {
                P(a, "neighbourhood", "suburb", "quarter", "residential", "city_district", "hamlet"),
                P(a, "city", "town", "village", "municipality", "county", "state_district"),
                P(a, "state"),
            }.Where(x => x is not null).Distinct().ToList();
            if (parts.Count > 0) name = string.Join(", ", parts);
        }
        if (name is null && root.TryGetProperty("display_name", out var dn) && dn.ValueKind == JsonValueKind.String)
            name = string.Join(", ", (dn.GetString() ?? "").Split(',').Select(s => s.Trim()).Where(s => s.Length > 0).Take(3));
        return string.IsNullOrWhiteSpace(name) ? null : name!.Length > 300 ? name[..300] : name;
    }
}

/// <summary>Fills the place names in the background (first run shortly after start, then every few minutes). Failures never stop the API.</summary>
public class LocationNameBackgroundService(IServiceScopeFactory scopes, IOptions<LocationNameOptions> options, ILogger<LocationNameBackgroundService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var o = options.Value;
        if (!o.Enabled) { log.LogInformation("Place name lookup is disabled."); return; }
        try { await Task.Delay(TimeSpan.FromSeconds(20), stop); } catch (OperationCanceledException) { return; }
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(Math.Max(1, o.IntervalMinutes)));
        do
        {
            try { using var scope = scopes.CreateScope(); await scope.ServiceProvider.GetRequiredService<LocationNameService>().ResolveMissingAsync(stop); }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { return; }
            catch (Exception ex) { log.LogError(ex, "Place name lookup run failed."); }
        } while (await Next(timer, stop));
    }

    private static async Task<bool> Next(PeriodicTimer t, CancellationToken stop) { try { return await t.WaitForNextTickAsync(stop); } catch (OperationCanceledException) { return false; } }
}
