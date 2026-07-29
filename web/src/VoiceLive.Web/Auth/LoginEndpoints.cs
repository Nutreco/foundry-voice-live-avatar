using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Options;

namespace VoiceLive.Web.Auth;

public static class LoginEndpoints
{
    public static void MapLogin(this WebApplication app)
    {
        app.MapGet("/login", (HttpContext ctx) =>
            Results.Content(Page(ctx.Request.Query.ContainsKey("error")), "text/html"))
            .AllowAnonymous();

        app.MapPost("/login", async (HttpContext ctx, IOptions<AuthOptions> opt) =>
        {
            var form = await ctx.Request.ReadFormAsync();
            var user = form["username"].ToString();
            var pass = form["password"].ToString();
            if (Valid(opt.Value, user, pass))
            {
                var identity = new ClaimsIdentity(
                    [new Claim(ClaimTypes.Name, user)],
                    CookieAuthenticationDefaults.AuthenticationScheme);
                await ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme,
                    new ClaimsPrincipal(identity));
                return Results.Redirect("/");
            }
            return Results.Redirect("/login?error=1");
        }).AllowAnonymous().RequireRateLimiting("login");

        app.MapPost("/logout", async (HttpContext ctx) =>
        {
            await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.Redirect("/login");
        });
    }

    private static bool Valid(AuthOptions o, string user, string pass)
    {
        if (!o.IsConfigured) return false;
        var u = CryptographicOperations.FixedTimeEquals(Utf8(user), Utf8(o.Username));
        var p = CryptographicOperations.FixedTimeEquals(Utf8(pass), Utf8(o.Password));
        return u && p;
    }

    private static byte[] Utf8(string s) => Encoding.UTF8.GetBytes(s);

    private static string Page(bool error) => $$"""
        <!doctype html><html><head><meta charset="utf-8"><title>Sign in</title>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>body{font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#111;color:#eee}
        form{display:grid;gap:.6rem;width:16rem}input{padding:.5rem}button{padding:.5rem;cursor:pointer}
        .err{color:#f66;min-height:1.2em}</style></head>
        <body><form method="post" action="/login">
        <h2>Voice Live Avatar</h2>
        <div class="err">{{(error ? "Invalid credentials" : "")}}</div>
        <input name="username" placeholder="Username" autocomplete="username" autofocus>
        <input name="password" type="password" placeholder="Password" autocomplete="current-password">
        <button type="submit">Sign in</button></form></body></html>
        """;
}
