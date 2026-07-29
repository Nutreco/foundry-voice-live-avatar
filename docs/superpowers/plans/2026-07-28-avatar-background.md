# Avatar Background and Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional HTTPS avatar background images, introduce explicit preview-avatar validation, and remove customized-avatar configuration.

**Architecture:** Extend the typed server avatar projection with nullable style, required local preview state, and an optional typed video background. Validate the raw JSON for removed properties and conditional fields before mapping the supported values into the Voice Live SDK, where avatars are always non-customized and preview only controls whether style is assigned.

**Tech Stack:** .NET 10, C# records, `System.Text.Json`, Azure.AI.VoiceLive 1.1.0, xUnit.

---

### Task 1: Define and validate the avatar schema

**Files:**
- Modify: `web/tests/VoiceLive.Web.Tests/ServerSessionConfigTests.cs`
- Modify: `web/src/VoiceLive.Web/Config/ServerSessionConfig.cs`
- Modify: `config/avatar.json`

- [ ] **Step 1: Write failing projection and validation tests**

In `web/tests/VoiceLive.Web.Tests/ServerSessionConfigTests.cs`, update the
default avatar assertions:

```csharp
        Assert.Equal("lisa", config.Avatar.Character);
        Assert.False(config.Avatar.Preview);
        Assert.Equal("casual-sitting", config.Avatar.Style);
        Assert.Null(config.Avatar.Video?.Background);
```

Add these tests before `BuildForAgent_omits_model_and_instructions_but_keeps_voice_avatar_and_audio`:

```csharp
    [Fact]
    public void AppConfigLoader_maps_optional_avatar_background()
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue(
            "avatar.json",
            "video.background",
            """{"imageUrl":"https://cdn.example.com/studio.jpg"}""");

        var loaded = AppConfigLoader.Load(config.Directory, ModelOpts());

        Assert.Equal(
            "https://cdn.example.com/studio.jpg",
            loaded.Server.Avatar.Video?.Background?.ImageUrl);
    }

    [Fact]
    public void AppConfigLoader_accepts_preview_avatar_without_style()
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue("avatar.json", "preview", "true");
        config.RemoveJsonValue("avatar.json", "style");

        var loaded = AppConfigLoader.Load(config.Directory, ModelOpts());

        Assert.True(loaded.Server.Avatar.Preview);
        Assert.Null(loaded.Server.Avatar.Style);
    }

    [Theory]
    [InlineData("preview", "true", "avatar.json: style: must be omitted when preview is true")]
    [InlineData("video.background", "\"not-an-object\"", "avatar.json: video.background: must be an object")]
    [InlineData("video.background", """{"imageUrl":""}""", "avatar.json: video.background.imageUrl: is required")]
    [InlineData("video.background", """{"imageUrl":"studio.jpg"}""", "avatar.json: video.background.imageUrl: must be an absolute HTTPS URL")]
    [InlineData("video.background", """{"imageUrl":"http://example.com/studio.jpg"}""", "avatar.json: video.background.imageUrl: must be an absolute HTTPS URL")]
    public void AppConfigLoader_rejects_invalid_avatar_preview_and_background_values(
        string field,
        string jsonValue,
        string expectedError)
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue("avatar.json", field, jsonValue);

        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(config.Directory, ModelOpts()));

        Assert.Contains(expectedError, ex.Message);
    }

    [Fact]
    public void AppConfigLoader_requires_preview_field()
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.RemoveJsonValue("avatar.json", "preview");

        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(config.Directory, ModelOpts()));

        Assert.Contains("avatar.json: preview: is required", ex.Message);
    }

    [Fact]
    public void AppConfigLoader_requires_style_for_non_preview_avatar()
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.RemoveJsonValue("avatar.json", "style");

        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(config.Directory, ModelOpts()));

        Assert.Contains("avatar.json: style: is required when preview is false", ex.Message);
    }

    [Fact]
    public void AppConfigLoader_rejects_removed_customized_field()
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue("avatar.json", "customized", "false");

        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(config.Directory, ModelOpts()));

        Assert.Contains("avatar.json: customized: is not supported", ex.Message);
    }
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
dotnet test web/tests/VoiceLive.Web.Tests/VoiceLive.Web.Tests.csproj \
  --filter "FullyQualifiedName~ServerSessionConfigTests"
```

Expected: FAIL because `Preview`, `Background`, and `ImageUrl` do not exist and
the current loader still requires style unconditionally.

- [ ] **Step 3: Add typed background and preview configuration**

In `web/src/VoiceLive.Web/Config/ServerSessionConfig.cs`, replace the avatar
records with:

```csharp
public sealed record ServerVideoResolutionConfig(int Width, int Height);
public sealed record ServerVideoBackgroundConfig(string ImageUrl);
public sealed record ServerVideoConfig(
    ServerVideoResolutionConfig Resolution,
    int? Bitrate = null,
    string? Codec = null,
    ServerVideoBackgroundConfig? Background = null);
public sealed record ServerAvatarConfig(
    string Character,
    string? Style,
    bool Preview,
    ServerVideoConfig? Video = null);
```

Replace the private avatar file record with nullable preview state:

```csharp
    private sealed record ServerAvatarFile(
        string? Character,
        string? Style,
        bool? Preview,
        ServerVideoConfig? Video = null);
```

- [ ] **Step 4: Validate raw removed fields and conditional avatar fields**

Change `ReadAvatarServer` to return whether the removed property was supplied:

```csharp
    private static (ServerAvatarFile? avatar, JsonElement? element) ReadAvatarServer(
        string dir,
        List<string> errors)
```

After confirming the JSON root is an object and before deserializing, add:

```csharp
            if (doc.RootElement.EnumerateObject().Any(
                    property => string.Equals(
                        property.Name,
                        "customized",
                        StringComparison.OrdinalIgnoreCase)))
                errors.Add("avatar.json: customized: is not supported");

            if (doc.RootElement.TryGetProperty("video", out var video)
                && video.ValueKind == JsonValueKind.Object
                && video.TryGetProperty("background", out var background)
                && background.ValueKind != JsonValueKind.Object)
            {
                errors.Add("avatar.json: video.background: must be an object");
                return (null, doc.RootElement.Clone());
            }
```

In `BuildProjections`, replace unconditional style validation:

```csharp
        RequireServer(avatar.Character, "avatar.json", "character", errors);
        RequireServer(avatar.Style, "avatar.json", "style", errors);
```

with:

```csharp
        RequireServer(avatar.Character, "avatar.json", "character", errors);
        if (avatar.Preview is null)
        {
            errors.Add("avatar.json: preview: is required");
        }
        else if (avatar.Preview.Value)
        {
            if (avatar.Style is not null)
                errors.Add("avatar.json: style: must be omitted when preview is true");
        }
        else if (string.IsNullOrWhiteSpace(avatar.Style))
        {
            errors.Add("avatar.json: style: is required when preview is false");
        }
```

Update server projection:

```csharp
            new ServerAvatarConfig(
                avatar.Character!,
                avatar.Style,
                avatar.Preview!.Value,
                avatar.Video),
```

- [ ] **Step 5: Validate the optional HTTPS background**

At the end of `ValidateAvatarSettings`, add:

```csharp
        if (avatar.Video.Background is not null)
        {
            var imageUrl = avatar.Video.Background.ImageUrl;
            if (string.IsNullOrWhiteSpace(imageUrl))
            {
                errors.Add("avatar.json: video.background.imageUrl: is required");
            }
            else if (!Uri.TryCreate(imageUrl, UriKind.Absolute, out var uri)
                     || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            {
                errors.Add("avatar.json: video.background.imageUrl: must be an absolute HTTPS URL");
            }
        }
```

Keep other malformed background JSON handled by the existing `JsonException`
path as invalid JSON for `avatar.json`.

- [ ] **Step 6: Update the default configuration**

Replace `config/avatar.json` with:

```json
{
  "character": "lisa",
  "preview": false,
  "style": "casual-sitting",
  "video": { "resolution": { "width": 1920, "height": 1080 }, "bitrate": 2000000, "codec": "h264" }
}
```

- [ ] **Step 7: Run the server configuration tests**

Run:

```bash
dotnet test web/tests/VoiceLive.Web.Tests/VoiceLive.Web.Tests.csproj \
  --filter "FullyQualifiedName~ServerSessionConfigTests"
```

Expected: all `ServerSessionConfigTests` pass.

- [ ] **Step 8: Commit the schema and validation**

```bash
git add config/avatar.json \
  web/src/VoiceLive.Web/Config/ServerSessionConfig.cs \
  web/tests/VoiceLive.Web.Tests/ServerSessionConfigTests.cs
git commit -m "feat(web): validate avatar preview config" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" \
  -m "Copilot-Session: 0bc8af99-30cd-4990-8a1c-7fd98ce769ef"
```

### Task 2: Map avatar background and preview behavior into the SDK

**Files:**
- Modify: `web/tests/VoiceLive.Web.Tests/ServerSessionConfigTests.cs`
- Modify: `web/src/VoiceLive.Web/Session/SessionOptionsBuilder.cs:130-145`

- [ ] **Step 1: Write failing SDK mapping tests**

Add these tests to `ServerSessionConfigTests.cs`:

```csharp
    [Fact]
    public void Build_maps_avatar_background_image_to_sdk_options()
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue(
            "avatar.json",
            "video.background",
            """{"imageUrl":"https://cdn.example.com/studio.jpg"}""");
        var server = AppConfigLoader.Load(config.Directory, ModelOpts()).Server;

        var options = SessionOptionsBuilder.Build(server, "Keep answers short.");

        Assert.Equal(
            "https://cdn.example.com/studio.jpg",
            options.Avatar.Video.Background.ImageUrl);
    }

    [Fact]
    public void Build_omits_style_for_preview_avatar()
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue("avatar.json", "preview", "true");
        config.RemoveJsonValue("avatar.json", "style");
        var server = AppConfigLoader.Load(config.Directory, ModelOpts()).Server;

        var options = SessionOptionsBuilder.Build(server, "Keep answers short.");

        Assert.False(options.Avatar.Customized);
        Assert.Null(options.Avatar.Style);
    }
```

Also add `Assert.False(options.Avatar.Customized);` to the existing normal and
agent-mode avatar mapping tests.

- [ ] **Step 2: Run the SDK mapping tests to verify they fail**

Run:

```bash
dotnet test web/tests/VoiceLive.Web.Tests/VoiceLive.Web.Tests.csproj \
  --filter "FullyQualifiedName~Build_maps_avatar_background_image_to_sdk_options|FullyQualifiedName~Build_omits_style_for_preview_avatar"
```

Expected: FAIL because `BuildAvatar` does not map background and still assigns
style unconditionally.

- [ ] **Step 3: Update `BuildAvatar`**

Replace `BuildAvatar` in
`web/src/VoiceLive.Web/Session/SessionOptionsBuilder.cs` with:

```csharp
    private static AvatarConfiguration BuildAvatar(ServerAvatarConfig config)
    {
        var avatar = new AvatarConfiguration(config.Character, customized: false);
        if (!config.Preview)
            avatar.Style = config.Style;

        if (config.Video is not null)
        {
            avatar.Video = new VideoParams
            {
                Bitrate = config.Video.Bitrate,
                Codec = config.Video.Codec,
                Resolution = new VideoResolution(
                    config.Video.Resolution.Width,
                    config.Video.Resolution.Height)
            };

            if (config.Video.Background is not null)
            {
                avatar.Video.Background = new VideoBackground
                {
                    ImageUrl = config.Video.Background.ImageUrl
                };
            }
        }

        return avatar;
    }
```

- [ ] **Step 4: Run the SDK mapping and complete backend tests**

Run:

```bash
dotnet test web/tests/VoiceLive.Web.Tests/VoiceLive.Web.Tests.csproj
```

Expected: all backend tests pass.

- [ ] **Step 5: Commit the SDK mapping**

```bash
git add web/src/VoiceLive.Web/Session/SessionOptionsBuilder.cs \
  web/tests/VoiceLive.Web.Tests/ServerSessionConfigTests.cs
git commit -m "feat(web): map avatar background options" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" \
  -m "Copilot-Session: 0bc8af99-30cd-4990-8a1c-7fd98ce769ef"
```

### Task 3: Document and verify the complete avatar configuration

**Files:**
- Modify: `docs/config-schema.md`
- Test: `web/tests/VoiceLive.Web.Tests/ServerSessionConfigTests.cs`

- [ ] **Step 1: Update avatar schema documentation**

Replace the `avatar.json` table rows for style and customized with:

```markdown
| `preview` | boolean | Required | Default: `false` | Local preview-avatar flag. Preview avatars omit `style`; this field is not sent to Voice Live. |
| `style` | string | Required when `preview` is `false`; forbidden when `preview` is `true` | Default: `casual-sitting` | Avatar style for a normal avatar. |
```

Add these video rows:

```markdown
| `video.background` | object | Optional | Contains `imageUrl` | Optional avatar video background. |
| `video.background.imageUrl` | string | Required when `video.background` is present | Absolute HTTPS URL | Background image URL sent to Voice Live. |
```

Add these validation rules:

```markdown
- `avatar.json.preview` is required.
- `avatar.json.style` is required when `preview` is `false` and must be omitted when `preview` is `true`.
- `avatar.json.customized` is not supported; the app currently creates only non-customized avatars.
- `avatar.json.video.background.imageUrl`, when configured, must be an absolute HTTPS URL.
```

- [ ] **Step 2: Run the full relevant validation**

Run:

```bash
dotnet test web/tests/VoiceLive.Web.Tests/VoiceLive.Web.Tests.csproj
dotnet build web/VoiceLive.Web.sln --no-restore
```

Expected: all tests pass and the solution builds without warnings or errors
introduced by this change.

- [ ] **Step 3: Review the final diff**

Run:

```bash
git diff --check
git status --short
git diff HEAD~2 -- config/avatar.json docs/config-schema.md \
  web/src/VoiceLive.Web/Config/ServerSessionConfig.cs \
  web/src/VoiceLive.Web/Session/SessionOptionsBuilder.cs \
  web/tests/VoiceLive.Web.Tests/ServerSessionConfigTests.cs
```

Expected: only the planned avatar schema, mapping, tests, and documentation are
changed.

- [ ] **Step 4: Commit documentation**

```bash
git add docs/config-schema.md
git commit -m "docs: describe avatar background config" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" \
  -m "Copilot-Session: 0bc8af99-30cd-4990-8a1c-7fd98ce769ef"
```
