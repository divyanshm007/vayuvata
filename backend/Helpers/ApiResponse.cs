namespace VayuVata.Helpers;

/// <summary>Consistent error body returned by every failing endpoint.</summary>
public class ApiError
{
    /// <summary>HTTP status code.</summary>
    public int Status { get; set; }
    /// <summary>Stable machine-readable code, e.g. "not_found".</summary>
    public string Code { get; set; } = "";
    public string Message { get; set; } = "";
    /// <summary>Per-field validation messages (validation errors only).</summary>
    public Dictionary<string, string[]>? Errors { get; set; }
    public string? TraceId { get; set; }
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
}
