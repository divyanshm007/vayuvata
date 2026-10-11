using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using VayuVata.Data;

namespace VayuVata.Controllers;

[ApiController]
[Route("api/v1/health")]
[AllowAnonymous]
public class HealthController(VayuVataDbContext db) : ControllerBase
{
    /// <summary>Liveness plus SQL Server connectivity. Returns 503 when the database is unreachable.</summary>
    [HttpGet]
    [ProducesResponseType(200)]
    [ProducesResponseType(503)]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var dbOk = await db.Database.CanConnectAsync(ct);
        var body = new { status = dbOk ? "Healthy" : "Unhealthy", database = dbOk ? "Connected" : "Unreachable", timeUtc = DateTime.UtcNow };
        return dbOk ? Ok(body) : StatusCode(503, body);
    }
}
