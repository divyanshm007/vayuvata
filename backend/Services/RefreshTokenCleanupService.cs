using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using VayuVata.Data;

namespace VayuVata.Services;

public class RefreshTokenCleanupOptions
{
    public bool Enabled { get; set; } = true;
    /// <summary>A token is deleted only once it expired more than this many days ago (minimum 1). Active tokens never qualify.</summary>
    public int RetentionDays { get; set; } = 30;
    public int BatchSize { get; set; } = 500;
    /// <summary>Upper bound per run, so a backlog is worked off over several runs instead of one unbounded delete.</summary>
    public int MaxBatchesPerRun { get; set; } = 20;
    public int IntervalMinutes { get; set; } = 360;
}

/// <summary>
/// Removes refresh tokens that EXPIRED more than RetentionDays ago. Revoked-but-unexpired tokens are deliberately kept until then
/// because reuse detection needs them. Runs once shortly after start-up and then on a timer; every run is bounded.
/// </summary>
public class RefreshTokenCleanupService(IServiceScopeFactory scopes, IOptions<RefreshTokenCleanupOptions> options, ILogger<RefreshTokenCleanupService> log)
    : BackgroundService
{
    private readonly RefreshTokenCleanupOptions _o = options.Value;

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        if (!_o.Enabled) { log.LogInformation("Refresh-token cleanup is disabled."); return; }
        try { await Task.Delay(TimeSpan.FromSeconds(3), stop); } catch (OperationCanceledException) { return; }

        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(Math.Max(1, _o.IntervalMinutes)));
        while (!stop.IsCancellationRequested)
        {
            try
            {
                await RunOnceAsync(stop);
                await timer.WaitForNextTickAsync(stop);
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { return; }
            catch (Exception ex)
            {
                log.LogWarning("Refresh-token cleanup skipped: {Reason}", ex.GetBaseException().Message);
                try { await timer.WaitForNextTickAsync(stop); } catch (OperationCanceledException) { return; }
            }
        }
    }

    /// <summary>Deletes expired-beyond-retention tokens in bounded batches; returns the number removed.</summary>
    public async Task<int> RunOnceAsync(CancellationToken ct)
    {
        var cutoff = DateTime.UtcNow.AddDays(-Math.Max(1, _o.RetentionDays));
        var batch = Math.Clamp(_o.BatchSize, 1, 5000);
        var total = 0;
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<VayuVataDbContext>();
        for (var i = 0; i < Math.Max(1, _o.MaxBatchesPerRun); i++)
        {
            var ids = await db.RefreshTokens.Where(t => t.ExpiresAt < cutoff).OrderBy(t => t.Id).Select(t => t.Id).Take(batch).ToListAsync(ct);
            if (ids.Count == 0) break;
            // The expiry condition is repeated in the DELETE so a token can never be removed unless it still qualifies.
            total += await db.RefreshTokens.Where(t => ids.Contains(t.Id) && t.ExpiresAt < cutoff).ExecuteDeleteAsync(ct);
            if (ids.Count < batch) break;
        }
        if (total > 0) log.LogInformation("Refresh-token cleanup removed {Count} token(s) expired before {Cutoff:u}", total, cutoff);
        return total;
    }
}
