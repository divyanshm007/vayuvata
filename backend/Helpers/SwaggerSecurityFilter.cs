using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.OpenApi;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace VayuVata.Helpers;

/// <summary>
/// Makes the OpenAPI document match reality: JWT Bearer only on [Authorize] operations, the ESP32
/// ingestion endpoint secured by the separate X-Device-Key scheme, and the shared ApiError body documented
/// for 400/401/403 where those can occur.
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
                Content = new Dictionary<string, OpenApiMediaType> { ["application/json"] = new OpenApiMediaType { Schema = error } },
            };
        }

        var hasInput = operation.RequestBody != null || (operation.Parameters?.Count ?? 0) > 0;
        if (hasInput) Add("400", "Validation failed or malformed request.");
        if (secured) { Add("401", "Missing, invalid or expired access token."); Add("403", "Authenticated but not permitted."); }
    }
}
