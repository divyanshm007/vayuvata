using FluentValidation;
using VayuVata.Helpers;

namespace VayuVata.Middleware;

/// <summary>Turns every exception into the consistent <see cref="ApiError"/> body. Never leaks internals.</summary>
public class ExceptionMiddleware(RequestDelegate next, ILogger<ExceptionMiddleware> log)
{
    public async Task Invoke(HttpContext ctx)
    {
        try { await next(ctx); }
        catch (Exception ex) when (!ctx.Response.HasStarted)
        {
            var error = Map(ex, ctx);
            ctx.Response.Clear();
            ctx.Response.StatusCode = error.Status;
            await ctx.Response.WriteAsJsonAsync(error);
        }
    }

    private ApiError Map(Exception ex, HttpContext ctx)
    {
        var trace = ctx.TraceIdentifier;
        switch (ex)
        {
            case ApiException api:
                return new ApiError { Status = api.Status, Code = api.Code, Message = api.Message, TraceId = trace };
            case ValidationException v:
                return new ApiError
                {
                    Status = 400, Code = "validation_failed", Message = "One or more validation errors occurred.", TraceId = trace,
                    Errors = v.Errors.GroupBy(e => e.PropertyName)
                        .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).ToArray()),
                };
            case BadHttpRequestException or System.Text.Json.JsonException:
                return new ApiError { Status = 400, Code = "bad_request", Message = "Malformed request.", TraceId = trace };
            case OperationCanceledException:
                return new ApiError { Status = 499, Code = "cancelled", Message = "Request cancelled.", TraceId = trace };
            default:
                log.LogError(ex, "Unhandled exception on {Method} {Path}", ctx.Request.Method, ctx.Request.Path);
                return new ApiError { Status = 500, Code = "server_error", Message = "An unexpected error occurred.", TraceId = trace };
        }
    }
}
