using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

public class AuthTests : IClassFixture<TestAppFactory>
{
    private readonly TestAppFactory _factory;
    public AuthTests(TestAppFactory factory) => _factory = factory;

    [Fact]
    public async Task Root_without_cookie_redirects_to_login()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var resp = await client.GetAsync("/");
        Assert.Equal(HttpStatusCode.Redirect, resp.StatusCode);
        Assert.Equal("/login", resp.Headers.Location!.OriginalString);
    }

    [Fact]
    public async Task Health_is_anonymous()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var resp = await client.GetAsync("/api/health");
        Assert.NotEqual(HttpStatusCode.Redirect, resp.StatusCode);
    }

    [Fact]
    public async Task Api_without_cookie_returns_401()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var resp = await client.GetAsync("/api/config");
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task Login_rejects_sixth_attempt_from_same_ip_with_429()
    {
        using var factory = new TestAppFactory();
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false
        });

        for (var attempt = 1; attempt <= 5; attempt++)
        {
            using var response = await client.PostAsync("/login", InvalidLogin());
            Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        }

        using var limited = await client.PostAsync("/login", InvalidLogin());
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
    }

    private static FormUrlEncodedContent InvalidLogin() => new(
    [
        new KeyValuePair<string, string>("username", "operator"),
        new KeyValuePair<string, string>("password", "incorrect")
    ]);
}
