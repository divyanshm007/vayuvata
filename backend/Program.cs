using System.Reflection;
using System.Text;
using System.Threading.RateLimiting;
using FluentValidation;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;
using VayuVata.Authorization;
using VayuVata.Data;
using VayuVata.Helpers;
using VayuVata.Middleware;
using VayuVata.Services;

// Schema changes are a separate, explicit step (never part of normal start-up): `VayuVata --migrate` / `--migration-status`.
if (MigrationRunner.IsMigrationCommand(args))
{
    var cli = WebApplication.CreateBuilder([]);
    return await MigrationRunner.RunAsync(args, cli.Configuration, cli.Environment.EnvironmentName);
}

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

// The framework's "Request starting/finished" lines contain the full URL INCLUDING the query string, which can carry secrets.
// Our own RequestContextMiddleware writes the access log instead (path only, redacted), so keep the framework's at Warning regardless of environment.
builder.Logging.AddFilter("Microsoft.AspNetCore.Hosting.Diagnostics", LogLevel.Warning);

// Hide the "Server: Kestrel" header and enforce the request-body cap. Kestrel does NOT bind Kestrel:Limits:* from configuration on its own,
// so the (optional) configured value is read and applied explicitly; default 16 KB. Larger bodies are answered with 413.
builder.WebHost.ConfigureKestrel(k =>
{
    k.AddServerHeader = false;
    k.Limits.MaxRequestBodySize = config.GetValue<long?>("Kestrel:Limits:MaxRequestBodySize") ?? 16 * 1024;
});

// ---- Configuration (secrets come from env vars / user-secrets, never source control) ----
var jwtOptions = config.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
if (string.IsNullOrWhiteSpace(jwtOptions.Key) || jwtOptions.Key.Length < 32)
    throw new InvalidOperationException("Jwt:Key must be set (>= 32 chars) via environment variable Jwt__Key or user-secrets.");
builder.Services.Configure<JwtOptions>(config.GetSection("Jwt"));
builder.Services.Configure<AuthOptions>(config.GetSection("Auth"));
builder.Services.Configure<IngestOptions>(config.GetSection("Ingest"));
builder.Services.Configure<DeviceAuthOptions>(config.GetSection("DeviceAuth"));
builder.Services.Configure<RefreshTokenCleanupOptions>(config.GetSection("RefreshTokens:Cleanup"));
builder.Services.AddHostedService<RefreshTokenCleanupService>();
builder.Services.Configure<GovDataOptions>(config.GetSection("DataGov"));
builder.Services.AddHttpClient("datagov", c => { c.Timeout = TimeSpan.FromSeconds(60); });
builder.Services.AddScoped<GovernmentDataService>();
builder.Services.AddHostedService<GovernmentDataBackgroundService>();

// ---- Database ----
builder.Services.AddDbContext<VayuVataDbContext>(o =>
    o.UseSqlServer(config.GetConnectionString("Default")
        ?? throw new InvalidOperationException("ConnectionStrings:Default is not configured.")));

// ---- Services (plain DI, no repositories) ----
builder.Services.AddScoped<JwtService>();
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<UserService>();
builder.Services.AddScoped<DeviceService>();
builder.Services.AddScoped<DeviceAssignmentService>();
builder.Services.AddScoped<SensorDataService>();
builder.Services.AddScoped<GpsLocationService>();
builder.Services.AddValidatorsFromAssemblyContaining<Program>();

// ---- Authentication / authorization ----
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.MapInboundClaims = false;   // keep short claim names: sub, role, email, name
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true, ValidIssuer = jwtOptions.Issuer,
            ValidateAudience = true, ValidAudience = jwtOptions.Audience,
            ValidateLifetime = true, ClockSkew = TimeSpan.FromSeconds(30),
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.Key)),
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
            RoleClaimType = "role", NameClaimType = "name",
        };
        o.Events = new JwtBearerEvents
        {
            // A still-valid token for a deleted/deactivated account must stop working immediately.
            OnTokenValidated = async ctx =>
            {
                var db = ctx.HttpContext.RequestServices.GetRequiredService<VayuVataDbContext>();
                var id = int.Parse(ctx.Principal!.FindFirst("sub")!.Value);
                var role = ctx.Principal.FindFirst("role")?.Value;
                var ok = await db.Users.AsNoTracking().AnyAsync(u => u.Id == id && u.IsActive && u.Role == role);
                if (!ok) ctx.Fail("Account is inactive or no longer exists.");
            },
            OnChallenge = async ctx =>
            {
                ctx.HandleResponse();
                await ctx.Response.WriteApiErrorAsync(ApiError.Create(ctx.HttpContext, 401, "unauthorized", "Missing, invalid or expired access token."));
            },
            OnForbidden = async ctx =>
            {
                await ctx.Response.WriteApiErrorAsync(ApiError.Create(ctx.HttpContext, 403, "forbidden", "You do not have permission to perform this action."));
            },
        };
    });
builder.Services.AddAuthorization(Policies.Register);
builder.Services.AddSingleton<Microsoft.AspNetCore.Authorization.IAuthorizationHandler, ScopeAuthorizationHandler>();

// ---- Rate limiting (login / refresh brute-force protection) ----
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.OnRejected = async (ctx, _) =>
    {
        if (ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retry))
            ctx.HttpContext.Response.Headers.RetryAfter = ((int)Math.Ceiling(retry.TotalSeconds)).ToString();
        await ctx.HttpContext.Response.WriteApiErrorAsync(ApiError.Create(ctx.HttpContext, 429, "rate_limited", "Too many requests. Try again later."));
    };
    o.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = config.GetValue("RateLimiting:LoginPermitLimit", 10),
            Window = TimeSpan.FromMinutes(1), QueueLimit = 0,
        }));
    // Public ESP32 ingestion: bounded per client IP so unauthenticated traffic cannot hammer the database.
    o.AddPolicy("ingest", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = config.GetValue("RateLimiting:IngestPermitPerMinute", 600),
            Window = TimeSpan.FromMinutes(1), QueueLimit = 0,
        }));
});

// ---- CORS (explicit origins only) ----
var origins = config.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
{
    if (origins.Length > 0) p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod();
}));

builder.Services.AddControllers().ConfigureApiBehaviorOptions(o =>
{
    // Binding/JSON errors use the same ApiError body as every other failure.
    o.InvalidModelStateResponseFactory = ctx =>
    {
        var errors = ctx.ModelState.Where(e => e.Value?.Errors.Count > 0)
            .ToDictionary(e => string.IsNullOrEmpty(e.Key) ? "body" : e.Key,
                          e => e.Value!.Errors.Select(x => x.ErrorMessage.Length > 0 ? x.ErrorMessage : "Invalid value.").ToArray());
        var result = new Microsoft.AspNetCore.Mvc.ObjectResult(
            ApiError.Create(ctx.HttpContext, 400, "validation_failed", "The request is malformed or invalid.", errors)) { StatusCode = 400 };
        result.ContentTypes.Add(ApiErrorExtensions.ChooseContentType(ctx.HttpContext.Request));
        return result;
    };
});

// ---- Swagger ----
var swaggerEnabled = config.GetValue<bool>("Swagger:Enabled");
if (swaggerEnabled)
{
    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddSwaggerGen(o =>
    {
        o.SwaggerDoc("v1", new OpenApiInfo
        {
            Title = "VayuVata API",
            Version = "v1",
            Description = """
                Air-quality monitoring backend. Roles: SuperAdmin, Admin, User (standalone User = User with no Admin).

                **User/Admin APIs** use a JWT: call `POST /api/v1/auth/login`, then click **Authorize** and paste the `accessToken`.

                **ESP32 ingestion** (`POST /api/v1/sensor-data`) does NOT use a JWT. Send the per-device key in the
                `X-Device-Key` header. The key is returned once by `POST /api/v1/devices` and can be replaced with
                `POST /api/v1/devices/{id}/rotate-key`.
                """,
        });
        var xml = Path.Combine(AppContext.BaseDirectory, $"{Assembly.GetExecutingAssembly().GetName().Name}.xml");
        if (File.Exists(xml)) o.IncludeXmlComments(xml);
        o.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
        {
            Type = SecuritySchemeType.Http, Scheme = "bearer", BearerFormat = "JWT",
            Description = "JWT access token from /api/v1/auth/login.",
        });
        o.AddSecurityDefinition(SwaggerSecurityFilter.DeviceKeyScheme, new OpenApiSecurityScheme
        {
            Type = SecuritySchemeType.ApiKey, In = ParameterLocation.Header, Name = "X-Device-Key",
            Description = "ESP32 per-device API key (issued once by POST /devices or /devices/{id}/rotate-key). Used ONLY by POST /sensor-data; never a JWT.",
        });
        // Stable, unique operationIds ("Controller_Action") so generated clients get predictable method names.
        o.CustomOperationIds(api => api.ActionDescriptor is Microsoft.AspNetCore.Mvc.Controllers.ControllerActionDescriptor c ? $"{c.ControllerName}_{c.ActionName}" : null);
        o.OperationFilter<SwaggerSecurityFilter>();
    });
}

var app = builder.Build();

app.UseMiddleware<RequestContextMiddleware>();   // outermost: request id, security headers and access log for every response
app.UseMiddleware<PublicListenerGuard>();         // on the public port only POST /api/v1/sensor-data may pass
app.UseMiddleware<ExceptionMiddleware>();
app.UseStatusCodePages(async ctx =>
{
    // Empty-bodied responses (404 unknown route, 405, 415...) get the standard error body too.
    var res = ctx.HttpContext.Response;
    if (res.ContentLength is null && res.ContentType is null)
        await res.WriteApiErrorAsync(ApiError.Create(ctx.HttpContext, res.StatusCode,
            res.StatusCode switch { 404 => "not_found", 405 => "method_not_allowed", 413 => "payload_too_large", 415 => "unsupported_media_type", _ => "error" },
            Microsoft.AspNetCore.WebUtilities.ReasonPhrases.GetReasonPhrase(res.StatusCode)));
});
if (!app.Environment.IsDevelopment()) app.UseHsts();
if (config.GetValue("Https:Redirect", false)) app.UseHttpsRedirection();
app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

if (swaggerEnabled)
{
    app.UseSwagger();
    app.UseSwaggerUI(o => o.SwaggerEndpoint("/swagger/v1/swagger.json", "VayuVata API v1"));
}

app.MapControllers();

// ---- Startup: SuperAdmin bootstrap. Schema migrations are NOT applied here (use `VayuVata --migrate`). ----
using (var scope = app.Services.CreateScope())
{
    var log = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
    try
    {
        if (config.GetValue<bool>("Database:ApplyMigrationsOnStartup"))
            log.LogWarning("Database:ApplyMigrationsOnStartup is no longer supported and is ignored. Apply schema changes with `VayuVata --migrate`.");
        var pending = (await scope.ServiceProvider.GetRequiredService<VayuVataDbContext>().Database.GetPendingMigrationsAsync()).ToList();
        if (pending.Count > 0)
            log.LogError("The database schema is behind this build ({Pending}). Run `VayuVata --migrate` with the migration login; the API will fail until then.", string.Join(", ", pending));
        await DbInitializer.BootstrapSuperAdminAsync(scope.ServiceProvider, log);
    }
    catch (Exception ex) when (ex is Microsoft.Data.SqlClient.SqlException or InvalidOperationException { InnerException: Microsoft.Data.SqlClient.SqlException })
    {
        // Stay up so /api/v1/health can report 503 instead of crash-looping while SQL Server is unreachable.
        log.LogError("Database unavailable at startup ({Reason}); the API will answer 503 on /health until it recovers.", ex.GetBaseException().Message);
    }
}

app.Run();
return 0;

public partial class Program;
