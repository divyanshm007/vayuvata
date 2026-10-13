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
            await ctx.Response.WriteApiErrorAsync(error);
        }
    }

    private ApiError Map(Exception ex, HttpContext ctx)
    {
        switch (ex)
        {
            case ApiException api:
                return ApiError.Create(ctx, api.Status, api.Code, api.Message);
            case ValidationException v:
                return ApiError.Create(ctx, 400, "validation_failed", "One or more validation errors occurred.",
                    v.Errors.GroupBy(e => e.PropertyName).ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).Distinct().ToArray()));
            case BadHttpRequestException { StatusCode: 413 }:
                return ApiError.Create(ctx, 413, "payload_too_large", "The request body exceeds the maximum allowed size.");
            case BadHttpRequestException { StatusCode: 408 }:
                return ApiError.Create(ctx, 408, "request_timeout", "The request was not received in time.");
            case BadHttpRequestException or System.Text.Json.JsonException:
                return ApiError.Create(ctx, 400, "bad_request", "Malformed request.");
            case OperationCanceledException:
                return ApiError.Create(ctx, 499, "cancelled", "Request cancelled.");
            default:
                // The exception (with stack trace) goes to the server log only, correlated by request id; never to the client.
                log.LogError(ex, "Unhandled exception on {Method} {Path} (request {RequestId})", ctx.Request.Method, LogRedactor.Clean(ctx.Request.Path.Value), ctx.TraceIdentifier);
                return ApiError.Create(ctx, 500, "server_error", "An unexpected error occurred.");
        }
    }
}
