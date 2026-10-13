using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;

namespace VayuVata.Helpers;

/// <summary>
/// Error body returned by every failing endpoint. It is an RFC 7807 problem document (<c>type</c>, <c>title</c>, <c>status</c>,
/// <c>detail</c>, <c>instance</c>) that ALSO keeps the original VayuVata fields (<c>code</c>, <c>message</c>, <c>errors</c>,
/// <c>traceId</c>), so existing clients that read those keep working. <c>traceId</c> equals the <c>X-Request-Id</c> response header.
/// </summary>
public class ApiError
{
    /// <summary>RFC 7807: URI identifying the problem type (urn:vayuvata:error:{code}).</summary>
    public string Type { get; set; } = "about:blank";
    /// <summary>RFC 7807: short, human-readable summary (the HTTP reason phrase).</summary>
    public string Title { get; set; } = "";
    /// <summary>HTTP status code.</summary>
    public int Status { get; set; }
    /// <summary>RFC 7807: explanation specific to this occurrence (same text as <c>message</c>).</summary>
    public string Detail { get; set; } = "";
    /// <summary>RFC 7807: the request path that produced the error.</summary>
    public string? Instance { get; set; }
    /// <summary>Stable machine-readable code, e.g. "not_found".</summary>
    public string Code { get; set; } = "";
    public string Message { get; set; } = "";
    /// <summary>Per-field validation messages (validation errors only), keyed by field name.</summary>
    public Dictionary<string, string[]>? Errors { get; set; }
    /// <summary>Correlation id; equals the X-Request-Id response header and appears in server logs.</summary>
    public string? TraceId { get; set; }

    public static ApiError Create(HttpContext ctx, int status, string code, string message, Dictionary<string, string[]>? errors = null) => new()
    {
        Type = $"urn:vayuvata:error:{code}",
        Title = ReasonPhrases.GetReasonPhrase(status) is { Length: > 0 } t ? t : "Error",
        Status = status, Detail = message, Code = code, Message = message, Errors = errors,
        Instance = ctx.Request.Path.HasValue ? LogRedactor.Clean(ctx.Request.Path.Value) : null,
        TraceId = ctx.TraceIdentifier,
    };
}

public static class ApiErrorExtensions
{
    public const string ProblemContentType = "application/problem+json";
    public const string ContentType = ProblemContentType;

    /// <summary>
    /// Content negotiation: the body is always the RFC 7807 problem document (plus the legacy fields), but it is labelled
    /// <c>application/json</c> - the media type existing clients and the ESP32 already receive - unless the caller asks for
    /// <c>application/problem+json</c> in its Accept header. This keeps simple HTTP clients that only treat application/json as text working.
    /// </summary>
    public static string ChooseContentType(HttpRequest req) =>
        req.Headers.Accept.ToString().Contains("problem+json", StringComparison.OrdinalIgnoreCase) ? ProblemContentType : "application/json";

    public static Task WriteApiErrorAsync(this HttpResponse res, ApiError error)
    {
        res.StatusCode = error.Status;
        return res.WriteAsJsonAsync(error, (JsonSerializerOptions?)null, ChooseContentType(res.HttpContext.Request));
    }
}

/// <summary>Thrown by services; translated to an <see cref="ApiError"/> by ExceptionMiddleware.</summary>
public class ApiException(int status, string code, string message) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;

    public static ApiException BadRequest(string msg, string code = "bad_request") => new(400, code, msg);
    public static ApiException Unauthorized(string msg = "Invalid or missing credentials.") => new(401, "unauthorized", msg);
    public static ApiException Forbidden(string msg = "You do not have permission to perform this action.") => new(403, "forbidden", msg);
    public static ApiException NotFound(string msg = "Resource not found.") => new(404, "not_found", msg);
    public static ApiException Conflict(string msg, string code = "conflict") => new(409, code, msg);
    public static ApiException TooManyRequests(string msg, string code = "too_many_requests") => new(429, code, msg);
}
