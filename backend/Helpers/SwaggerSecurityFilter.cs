using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.OpenApi;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace VayuVata.Helpers;

/// <summary>
/// Makes the OpenAPI document match reality: JWT Bearer only on [Authorize] operations, the ESP32
/// ingestion endpoint secured by the separate X-Device-Key scheme, and the shared ApiError (RFC 7807) body documented
/// for every error status an operation can return (400/401/403/404/413/429/500) plus the X-Request-Id header on each response.
/// </summary>
public class SwaggerSecurityFilter : IOperationFilter
{
    public const string DeviceKeyScheme = "DeviceKey";

    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        var meta = context.ApiDescription.ActionDescriptor.EndpointMetadata;
        var anonymous = meta.OfType<IAllowAnonymous>().Any();
        var secured = !anonymous && meta.OfType<IAuthorizeData>().Any();
        var isIngest = context.ApiDescription.ActionDescriptor is ControllerActionDescriptor { ActionName: "Ingest" };
        var rateLimited = meta.OfType<EnableRateLimitingAttribute>().Any();
        var hasPathParam = context.ApiDescription.ParameterDescriptions.Any(p => p.Source.Id == "Path");

        operation.Security ??= [];
        if (secured)
            operation.Security.Add(new OpenApiSecurityRequirement { [new OpenApiSecuritySchemeReference("Bearer", context.Document)] = [] });
        else if (isIngest)
            operation.Security.Add(new OpenApiSecurityRequirement { [new OpenApiSecuritySchemeReference(DeviceKeyScheme, context.Document)] = [] });

        var error = context.SchemaGenerator.GenerateSchema(typeof(ApiError), context.SchemaRepository);
        void Add(string code, string description)
        {
            operation.Responses ??= new OpenApiResponses();
            if (operation.Responses.ContainsKey(code)) return;
            operation.Responses[code] = new OpenApiResponse
            {
                Description = description,
                Content = new Dictionary<string, OpenApiMediaType>
                {
                    ["application/json"] = new OpenApiMediaType { Schema = error },
                    [ApiErrorExtensions.ContentType] = new OpenApiMediaType { Schema = error },
                },
            };
        }

        var hasBody = operation.RequestBody != null;
        var hasInput = hasBody || (operation.Parameters?.Count ?? 0) > 0;
        if (hasInput) Add("400", "Validation failed or malformed request.");
        if (secured) { Add("401", "Missing, invalid or expired access token."); Add("403", "Authenticated but not permitted."); }
        if (hasPathParam) Add("404", "The addressed resource does not exist or is outside the caller's scope.");
        if (hasBody) Add("413", "The request body exceeds the maximum size (16 KB).");
        if (rateLimited) Add("429", "Too many requests from this address; honour the Retry-After header.");
        Add("500", "Unexpected server error. The body carries only a traceId; details are in the server log under that id.");

        // Correlation id on every documented response.
        foreach (var response in operation.Responses!.Values)
        {
            if (response is not OpenApiResponse r) continue;
            r.Headers ??= new Dictionary<string, IOpenApiHeader>();
            r.Headers["X-Request-Id"] = new OpenApiHeader
            {
                Description = "Correlation id of this request (also returned as traceId in error bodies and written to the server log).",
                Schema = new OpenApiSchema { Type = JsonSchemaType.String },
            };
        }
    }
}
