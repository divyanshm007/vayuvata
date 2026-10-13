using System.Diagnostics;
using VayuVata.Helpers;

namespace VayuVata.Middleware;

/// <summary>
/// Outermost middleware: assigns the correlation id (X-Request-Id, also HttpContext.TraceIdentifier and a log scope),
/// adds the security response headers to EVERY response (including 404/401/429/5xx), and writes one access-log line per request.
/// The access log records method, path (no query string), status, duration, client IP and authenticated user id only -
/// never headers, bodies or tokens - and passes the path through <see cref="LogRedactor"/>.
/// </summary>
public class RequestContextMiddleware(RequestDelegate next, ILogger<RequestContextMiddleware> log)
{
    public const string HeaderName = "X-Request-Id";

    public async Task Invoke(HttpContext ctx)
    {
        var id = ResolveId(ctx.Request.Headers[HeaderName].ToString());
        ctx.TraceIdentifier = id;
        var path = ctx.Request.Path.Value ?? "/";
        var swagger = path.StartsWith("/swagger", StringComparison.OrdinalIgnoreCase);

        ctx.Response.OnStarting(static state =>
        {
            var (c, rid, isSwagger) = ((HttpContext, string, bool))state;
            var h = c.Response.Headers;
            h[HeaderName] = rid;
            h["X-Content-Type-Options"] = "nosniff";
            h["X-Frame-Options"] = "DENY";
            h["Referrer-Policy"] = "no-referrer";
            h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
            if (!isSwagger)
            {
                // JSON API: never cache responses (they contain personal data and tokens) and never render them as a page.
                h["Cache-Control"] = "no-store";
                h["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'";
            }
            return Task.CompletedTask;
        }, (ctx, id, swagger));

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
