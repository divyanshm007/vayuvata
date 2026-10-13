namespace VayuVata.Middleware;

/// <summary>
/// Network-boundary guard for the internet-facing listener. When <c>PublicListener:Port</c> is set, any request that
/// arrives on that local port is answered with an empty 404 unless it is exactly
/// <c>POST /api/v1/sensor-data</c> (configurable via <c>PublicListener:AllowedPath</c>). Everything else - login, user and
/// device management, reads, health, Swagger - is only reachable on the private listener (127.0.0.1).
/// The decision uses the connection's local port, never a client-supplied header, so it cannot be spoofed.
/// Disabled when the port is 0 / unset (local development, tests of the private API).
/// </summary>
public class PublicListenerGuard(RequestDelegate next, IConfiguration config)
{
    private readonly int _port = config.GetValue("PublicListener:Port", 0);
    private readonly string _allowedPath = config.GetValue("PublicListener:AllowedPath", "/api/v1/sensor-data")!;
    /// <summary>Second device-upload endpoint (GPS position reports); same rules: POST only, device key required by the endpoint itself.</summary>
    private const string GpsPath = "/api/v1/gps-data";

    public Task Invoke(HttpContext ctx)
    {
        if (_port == 0 || ctx.Connection.LocalPort != _port) return next(ctx);

        var allowed = HttpMethods.IsPost(ctx.Request.Method)
                      && (string.Equals(ctx.Request.Path.Value, _allowedPath, StringComparison.OrdinalIgnoreCase)
                          || string.Equals(ctx.Request.Path.Value, GpsPath, StringComparison.OrdinalIgnoreCase));
        if (allowed) return next(ctx);

        ctx.Response.StatusCode = StatusCodes.Status404NotFound;   // empty body: reveals nothing about the private API
        return Task.CompletedTask;
    }
}
