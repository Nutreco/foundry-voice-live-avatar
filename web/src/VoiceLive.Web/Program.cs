using System.Net.WebSockets;
using System.Threading.RateLimiting;
using Azure.Monitor.OpenTelemetry.AspNetCore;
using Microsoft.Extensions.Options;
using OpenTelemetry.Metrics;
using VoiceLive.Web.Auth;
using VoiceLive.Web.Config;
using VoiceLive.Web.Session;

var builder = WebApplication.CreateBuilder(args);
builder.Services.Configure<VoiceLive.Web.Auth.AuthOptions>(
    builder.Configuration.GetSection(VoiceLive.Web.Auth.AuthOptions.SectionName));
builder.Services.Configure<VoiceLive.Web.Config.VoiceLiveOptions>(
    builder.Configuration.GetSection(VoiceLive.Web.Config.VoiceLiveOptions.SectionName));
builder.Services.PostConfigure<VoiceLive.Web.Config.VoiceLiveOptions>(o =>
{
    var top = builder.Configuration["ConfigDir"];
    if (!string.IsNullOrEmpty(top)) o.ConfigDir = top;
});
builder.Services.AddAuthentication(Microsoft.AspNetCore.Authentication.Cookies.CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.LoginPath = "/login";
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Lax;
        o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
        o.ExpireTimeSpan = TimeSpan.FromHours(8);
        o.SlidingExpiration = true;
    });
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("login", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 5,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            }));
});
builder.Services.AddSingleton<VoiceLive.Web.Config.ConfigState>(sp =>
{
    var o = sp.GetRequiredService<IOptions<VoiceLive.Web.Config.VoiceLiveOptions>>().Value;
    try { return new VoiceLive.Web.Config.ConfigState(VoiceLive.Web.Config.AppConfigLoader.Load(o.ConfigDir, o), null); }
    catch (VoiceLive.Web.Config.WebConfigValidationException ex) { return new VoiceLive.Web.Config.ConfigState(null, ex.Message); }
});
builder.Services.AddHealthChecks().AddCheck<VoiceLive.Web.Health.ConfigHealthCheck>("config");
builder.Services.AddSingleton(sp =>
    new VoiceLive.Web.Session.SessionGate(
        sp.GetRequiredService<IOptions<VoiceLive.Web.Config.VoiceLiveOptions>>().Value.MaxConcurrentSessions));
builder.Services.AddSingleton<Azure.Core.TokenCredential>(_ =>
{
    var clientId = builder.Configuration["AZURE_CLIENT_ID"];
    var options = new Azure.Identity.DefaultAzureCredentialOptions();
    if (!string.IsNullOrWhiteSpace(clientId)) options.ManagedIdentityClientId = clientId;
    return new Azure.Identity.DefaultAzureCredential(options);
});
builder.Services.AddSingleton<VoiceLive.Web.Session.IVoiceLiveBridgeFactory, VoiceLive.Web.Session.VoiceLiveBridgeFactory>();
var otel = builder.Services.AddOpenTelemetry().WithMetrics(m => m.AddMeter("VoiceLive.Web"));
if (!string.IsNullOrWhiteSpace(builder.Configuration["APPLICATIONINSIGHTS_CONNECTION_STRING"]))
    otel.UseAzureMonitor();
var app = builder.Build();

var configState = app.Services.GetRequiredService<VoiceLive.Web.Config.ConfigState>();
if (configState.Error is not null)
    app.Logger.LogCritical("Configuration is invalid; the app will report unhealthy until fixed: {Error}", configState.Error);

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
    app.UseHttpsRedirection();
}
app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["X-Content-Type-Options"] = "nosniff";
    h["X-Frame-Options"] = "DENY";
    h["Referrer-Policy"] = "no-referrer";
    h["Content-Security-Policy"] =
        "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; " +
        "connect-src 'self' wss: https:; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:";
    await next();
});

app.UseRateLimiter();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });

app.UseAuthentication();
app.Use(async (ctx, next) =>
{
    var path = ctx.Request.Path;
    var anon = path.StartsWithSegments("/login")
        || path.StartsWithSegments("/logout")
        || path.Equals("/api/health", StringComparison.OrdinalIgnoreCase);
    if (!anon && !(ctx.User.Identity?.IsAuthenticated ?? false))
    {
        if (path.StartsWithSegments("/ws") || path.StartsWithSegments("/api"))
        {
            ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }
        ctx.Response.Redirect("/login");
        return;
    }
    await next();
});

app.UseDefaultFiles();
app.UseStaticFiles();

app.UseAuthorization();

app.MapHealthChecks("/api/health").AllowAnonymous();

app.MapGet("/api/config", (VoiceLive.Web.Config.ConfigState state) =>
    state.Config is not null
        ? Results.Ok(state.Config.Client)
        : Results.Json(new { error = state.Error }, statusCode: StatusCodes.Status503ServiceUnavailable));

app.Map("/ws/session", async (
    HttpContext context,
    SessionGate gate,
    IVoiceLiveBridgeFactory factory,
    VoiceLive.Web.Config.ConfigState configState,
    IOptions<VoiceLive.Web.Config.VoiceLiveOptions> opt) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsJsonAsync(new { error = "Expected a WebSocket request." });
        return;
    }
    if (!OriginAllowed(context, opt.Value.AllowedOrigins))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
    }
    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    if (configState.Config is null)
    {
        await SendStartupErrorAsync(socket, configState.Error ?? "Server configuration is invalid.", context.RequestAborted);
        return;
    }
    if (!gate.TryEnter())
    {
        await SendStartupErrorAsync(socket, "The server is at capacity. Try again shortly.", context.RequestAborted);
        return;
    }
    try
    {
        await factory.Create(configState.Config).RunAsync(socket, context.RequestAborted);
    }
    finally
    {
        gate.Exit();
    }
});

app.MapLogin();

static async Task SendStartupErrorAsync(WebSocket socket, string message, CancellationToken ct)
{
    if (socket.State == WebSocketState.Open)
    {
        var bytes = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(new { t = "error", message });
        await socket.SendAsync(bytes, WebSocketMessageType.Text, WebSocketMessageFlags.EndOfMessage, ct);
        await socket.CloseAsync(WebSocketCloseStatus.InternalServerError, "configuration failed", ct);
    }
}

static bool OriginAllowed(HttpContext ctx, string[] allowed)
{
    var origin = ctx.Request.Headers.Origin.ToString();
    if (string.IsNullOrEmpty(origin)) return true; // non-browser client (no Origin)
    if (allowed.Length > 0 && allowed.Contains(origin, StringComparer.OrdinalIgnoreCase)) return true;
    // same-origin: Origin scheme+host[:port] equals request host
    var self = $"{ctx.Request.Scheme}://{ctx.Request.Host.Value}";
    return string.Equals(origin, self, StringComparison.OrdinalIgnoreCase);
}

app.Run();

public partial class Program { }
