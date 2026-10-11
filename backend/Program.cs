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

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

// ---- Configuration (secrets come from env vars / user-secrets, never source control) ----
var jwtOptions = config.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
if (string.IsNullOrWhiteSpace(jwtOptions.Key) || jwtOptions.Key.Length < 32)
    throw new InvalidOperationException("Jwt:Key must be set (>= 32 chars) via environment variable Jwt__Key or user-secrets.");
builder.Services.Configure<JwtOptions>(config.GetSection("Jwt"));

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
                ctx.Response.StatusCode = 401;
                await ctx.Response.WriteAsJsonAsync(new ApiError
                {
                    Status = 401, Code = "unauthorized", Message = "Missing, invalid or expired access token.",
                    TraceId = ctx.HttpContext.TraceIdentifier,
                });
            },
            OnForbidden = async ctx =>
            {
                ctx.Response.StatusCode = 403;
                await ctx.Response.WriteAsJsonAsync(new ApiError
                {
                    Status = 403, Code = "forbidden", Message = "You do not have permission to perform this action.",
                    TraceId = ctx.HttpContext.TraceIdentifier,
                });
            },
        };
    });
builder.Services.AddAuthorization(Policies.Register);
builder.Services.AddSingleton<Microsoft.AspNetCore.Authorization.IAuthorizationHandler, ScopeAuthorizationHandler>();

// ---- Rate limiting (login / refresh brute-force protection) ----
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
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
    o.InvalidModelStateResponseFactory = ctx => new Microsoft.AspNetCore.Mvc.ObjectResult(new ApiError
    {
        Status = 400, Code = "validation_failed", Message = "The request is malformed or invalid.",
        TraceId = ctx.HttpContext.TraceIdentifier,
        Errors = ctx.ModelState.Where(e => e.Value?.Errors.Count > 0)
            .ToDictionary(e => string.IsNullOrEmpty(e.Key) ? "body" : e.Key,
                          e => e.Value!.Errors.Select(x => x.ErrorMessage.Length > 0 ? x.ErrorMessage : "Invalid value.").ToArray()),
    }) { StatusCode = 400 };
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
        o.OperationFilter<SwaggerSecurityFilter>();
    });
}

var app = builder.Build();

app.UseMiddleware<PublicListenerGuard>();   // first: on the public port only POST /api/v1/sensor-data may pass
app.UseMiddleware<ExceptionMiddleware>();
app.UseStatusCodePages(async ctx =>
{
    // Empty-bodied responses (404 unknown route, 405, 415...) get the standard error body too.
    var res = ctx.HttpContext.Response;
    if (res.ContentLength is null && res.ContentType is null)
        await res.WriteAsJsonAsync(new ApiError
        {
            Status = res.StatusCode, Code = res.StatusCode switch { 404 => "not_found", 405 => "method_not_allowed", 415 => "unsupported_media_type", _ => "error" },
            Message = Microsoft.AspNetCore.WebUtilities.ReasonPhrases.GetReasonPhrase(res.StatusCode), TraceId = ctx.HttpContext.TraceIdentifier,
        });
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

// ---- Startup: optional migrate (dev/test) + SuperAdmin bootstrap ----
using (var scope = app.Services.CreateScope())
{
    var log = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
    try
    {
        if (config.GetValue<bool>("Database:ApplyMigrationsOnStartup"))
            await scope.ServiceProvider.GetRequiredService<VayuVataDbContext>().Database.MigrateAsync();
        await DbInitializer.BootstrapSuperAdminAsync(scope.ServiceProvider, log);
    }
    catch (Exception ex) when (ex is Microsoft.Data.SqlClient.SqlException or InvalidOperationException { InnerException: Microsoft.Data.SqlClient.SqlException })
    {
        // Stay up so /api/v1/health can report 503 instead of crash-looping while SQL Server is unreachable.
        log.LogError("Database unavailable at startup ({Reason}); the API will answer 503 on /health until it recovers.", ex.GetBaseException().Message);
    }
}

app.Run();

public partial class Program;
