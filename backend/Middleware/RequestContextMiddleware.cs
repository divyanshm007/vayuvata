using System.Diagnostics;
using VayuVata.Helpers;

namespace VayuVata.Middleware;

/// <summary>
/// Outermost middleware: assigns the correlation id (X-Request-Id, also HttpContext.TraceIdentifier and a log scope),
/// adds the security response headers to EVERY response (including 404/401/429/5xx), and writes one access-log line per request.
/// The access log records method, path (no query string), status, duration, client IP and authenticated user id only -
/// never headers, bodies or tokens - and passes the path through <see cref="LogRedactor"/>.
/// </summary>
public class RequestContextMiddleware(RequestDelegate next, ILogger<RequestContextMiddleware> log, IConfiguration config)
{
    public const string HeaderName = "X-Request-Id";

    /// <summary>
    /// CSP of the web panel pages (anything that is not /api or /swagger). Scripts only from this server (the panel has no inline scripts); styles may be inline (the UI library injects them)
    /// plus Google Fonts; images from this server, data URIs and the map tile server(s) in <c>Panel:ImgSrc</c> (default OpenStreetMap); API calls only to this server.
    /// </summary>
    private readonly string _panelCsp =
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; " +
        $"img-src 'self' data: blob: {config.GetValue("Panel:ImgSrc", "https://tile.openstreetmap.org")}; connect-src 'self'; " +
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

    public async Task Invoke(HttpContext ctx)
    {
        var id = ResolveId(ctx.Request.Headers[HeaderName].ToString());
        ctx.TraceIdentifier = id;
        var path = ctx.Request.Path.Value ?? "/";
        var swagger = path.StartsWith("/swagger", StringComparison.OrdinalIgnoreCase);
        var panel = !swagger && !path.StartsWith("/api", StringComparison.OrdinalIgnoreCase);   // the static web panel (index.html, /assets/...)

        ctx.Response.OnStarting(static state =>
        {
            var (c, rid, isSwagger, isPanel, panelCsp) = ((HttpContext, string, bool, bool, string))state;
            var h = c.Response.Headers;
            h[HeaderName] = rid;
            h["X-Content-Type-Options"] = "nosniff";
            h["X-Frame-Options"] = "DENY";
            // The panel needs a Referer on cross-origin requests: the OpenStreetMap tile servers require one. Only the ORIGIN is sent, never a path.
            h["Referrer-Policy"] = isPanel ? "strict-origin-when-cross-origin" : "no-referrer";
            h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
            if (isPanel)
            {
                // Caching of panel files is decided by the static file middleware (hashed assets long, index.html revalidated).
                h["Content-Security-Policy"] = panelCsp;
            }
            else if (!isSwagger)
            {
                // JSON API: never cache responses (they contain personal data and tokens) and never render them as a page.
                h["Cache-Control"] = "no-store";
                h["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'";
            }
            return Task.CompletedTask;
        }, (ctx, id, swagger, panel, _panelCsp));

        var sw = Stopwatch.StartNew();
        using (log.BeginScope(new Dictionary<string, object> { ["RequestId"] = id }))
        {
            try { await next(ctx); }
            finally
            {
                sw.Stop();
                var level = ctx.Response.StatusCode >= 500 ? LogLevel.Error
                    : path.EndsWith("/health", StringComparison.OrdinalIgnoreCase) ? LogLevel.Debug : LogLevel.Information;
                var sub = ctx.User.FindFirst("sub")?.Value;
                log.Log(level, "HTTP {Method} {Path} -> {Status} in {ElapsedMs} ms (ip {ClientIp}, port {LocalPort}, user {UserId}, request {RequestId})",
                    ctx.Request.Method, LogRedactor.Clean(path), ctx.Response.StatusCode, sw.ElapsedMilliseconds,
                    ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown", ctx.Connection.LocalPort, sub ?? "-", id);
            }
        }
    }

    /// <summary>Accepts a caller-supplied id only if it is short and made of safe characters; otherwise generates one.</summary>
    private static string ResolveId(string supplied)
    {
        if (supplied.Length is > 0 and <= 64 && supplied.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.')) return supplied;
        return Guid.NewGuid().ToString("N");
    }
}
