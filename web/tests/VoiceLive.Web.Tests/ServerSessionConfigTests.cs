using Azure.AI.VoiceLive;
using System.Text.Json;
using System.Text.Json.Nodes;
using VoiceLive.Web.Config;
using VoiceLive.Web.Session;
using Xunit;

public class ServerSessionConfigTests
{
    private static string RepoConfigDir => TestAppFactory.RepoConfigDir;
    private static VoiceLiveOptions ModelOpts() => new() { Endpoint = "https://x", Mode = "model", ApiVersion = "2025-10-01" };

    [Fact]
    public void Turn_mode_schema_contains_only_supported_properties()
    {
        var properties = typeof(ServerTurnModeConfig)
            .GetProperties()
            .Select(property => property.Name)
            .OrderBy(name => name);

        Assert.Equal(["ManualTurn", "TurnDetection"], properties);
    }

    [Fact]
    public void LoadServerSession_returns_endpoint_and_active_turn_mode()
    {
        var config = AppConfigLoader.Load(RepoConfigDir, ModelOpts()).Server;

        Assert.Equal("https://x", config.Endpoint);
        Assert.Equal("2025-10-01", config.ApiVersion);
        Assert.Equal("gpt-realtime", config.Model);
        Assert.Equal("gated", config.TurnTaking.ActiveMode);
        Assert.True(config.TurnTaking.ActiveModeConfig.ManualTurn);
        Assert.Equal("lisa", config.Avatar.Character);
        Assert.Equal("casual-sitting", config.Avatar.Style);
        Assert.Equal(1920, config.Avatar.Video?.Resolution.Width);
    }

    [Fact]
    public void Build_maps_gated_avatar_session_to_verified_sdk_options()
    {
        var config = AppConfigLoader.Load(RepoConfigDir, ModelOpts()).Server;

        var options = SessionOptionsBuilder.Build(config, "Keep answers short.");

        Assert.Equal("gpt-realtime", options.Model);
        Assert.Equal("Keep answers short.", options.Instructions);
        Assert.IsType<AzureStandardVoice>(options.Voice);
        Assert.True(options.TurnDetection is null || options.TurnDetection is NoTurnDetection);
        Assert.Equal(InputAudioFormat.Pcm16, options.InputAudioFormat);
        Assert.Equal(OutputAudioFormat.Pcm16, options.OutputAudioFormat);
        Assert.Equal(24000, options.InputAudioSamplingRate);
        Assert.Null(options.InputAudioEchoCancellation);
        Assert.Null(options.InputAudioTranscription);
        Assert.Contains(options.Modalities, m => m.Equals(InteractionModality.Text));
        Assert.Contains(options.Modalities, m => m.Equals(InteractionModality.Audio));
        Assert.NotNull(options.Avatar);
        Assert.False(options.Avatar.Customized);
        Assert.Equal("lisa", options.Avatar.Character);
        Assert.Equal("casual-sitting", options.Avatar.Style);
        Assert.Equal(2000000, options.Avatar.Video.Bitrate);
        Assert.Equal("h264", options.Avatar.Video.Codec);
        Assert.Equal(1920, options.Avatar.Video.Resolution.Width);
        Assert.Equal(1080, options.Avatar.Video.Resolution.Height);
    }

    [Fact]
    public void Build_always_uses_browser_pcm_sampling_rate()
    {
        var config = AppConfigLoader.Load(RepoConfigDir, ModelOpts()).Server;

        var options = SessionOptionsBuilder.Build(config, "Keep answers short.");

        Assert.Equal(24000, SessionOptionsBuilder.BrowserPcmSamplingRate);
        Assert.Equal(24000, options.InputAudioSamplingRate);
    }

    [Fact]
    public void LoadServerSession_defaults_mode_to_model()
    {
        var config = AppConfigLoader.Load(RepoConfigDir, ModelOpts()).Server;
        Assert.Equal("model", config.Mode);
    }

    [Fact]
    public void AppConfigLoader_missing_endpoint_throws()
    {
        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(RepoConfigDir, new VoiceLiveOptions { Endpoint = "", Mode = "model" }));
        Assert.Contains("VoiceLive:Endpoint", ex.Message);
    }

    [Fact]
    public void AppConfigLoader_unknown_api_version_throws()
    {
        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(RepoConfigDir, new VoiceLiveOptions { Endpoint = "https://x", ApiVersion = "1999-01-01", Mode = "model" }));
        Assert.Contains("apiVersion '1999-01-01' is not supported", ex.Message);
    }

    [Fact]
    public void AppConfigLoader_agent_mode_allows_missing_model_and_grounding()
    {
        var config = AppConfigLoader.Load(RepoConfigDir, new VoiceLiveOptions { Endpoint = "https://x", Mode = "agent" });
        Assert.Equal("agent", config.Server.Mode);
    }

    [Theory]
    [InlineData("session.json", "inputAudioTranscription.model", "\"\"", "session.json: inputAudioTranscription.model: is required")]
    [InlineData("session.json", "inputAudioNoiseReduction.type", "\"unknown\"", "session.json: inputAudioNoiseReduction.type: 'unknown' is not supported")]
    [InlineData("session.json", "inputAudioEchoCancellation.type", "\"unknown\"", "session.json: inputAudioEchoCancellation.type: 'unknown' is not supported")]
    [InlineData("turntaking.json", "modes.open-mic.turnDetection.type", "\"unknown\"", "turntaking.json: modes.open-mic.turnDetection.type: 'unknown' is not supported")]
    [InlineData("turntaking.json", "modes.open-mic.turnDetection.threshold", "1.1", "turntaking.json: modes.open-mic.turnDetection.threshold: must be between 0 and 1")]
    [InlineData("turntaking.json", "modes.open-mic.turnDetection.prefixPaddingMs", "-1", "turntaking.json: modes.open-mic.turnDetection.prefixPaddingMs: must be non-negative")]
    [InlineData("turntaking.json", "modes.open-mic.turnDetection.silenceDurationMs", "-1", "turntaking.json: modes.open-mic.turnDetection.silenceDurationMs: must be non-negative")]
    [InlineData("turntaking.json", "modes.open-mic.turnDetection.endOfUtteranceDetection.model", "\"unknown\"", "turntaking.json: modes.open-mic.turnDetection.endOfUtteranceDetection.model: 'unknown' is not supported")]
    [InlineData("turntaking.json", "modes.open-mic.turnDetection.endOfUtteranceDetection.thresholdLevel", "\"extreme\"", "turntaking.json: modes.open-mic.turnDetection.endOfUtteranceDetection.thresholdLevel: 'extreme' is not supported")]
    [InlineData("turntaking.json", "modes.open-mic.turnDetection.endOfUtteranceDetection.timeoutMs", "0", "turntaking.json: modes.open-mic.turnDetection.endOfUtteranceDetection.timeoutMs: must be positive")]
    [InlineData("avatar.json", "video.resolution.width", "0", "avatar.json: video.resolution.width: must be positive")]
    [InlineData("avatar.json", "video.resolution.height", "-1", "avatar.json: video.resolution.height: must be positive")]
    [InlineData("avatar.json", "video.bitrate", "0", "avatar.json: video.bitrate: must be positive")]
    [InlineData("avatar.json", "video.codec", "\"vp9\"", "avatar.json: video.codec: 'vp9' is not supported")]
    public void AppConfigLoader_rejects_nested_values_that_cannot_reach_the_sdk(
        string file,
        string field,
        string jsonValue,
        string expectedError)
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue(file, field, jsonValue);

        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(config.Directory, ModelOpts()));

        Assert.Contains(expectedError, ex.Message);
    }

    [Theory]
    [InlineData(
        "turntaking.json",
        "modes.open-mic.turnDetection.endOfUtteranceDetection.thresholdLevel",
        "turntaking.json: modes.open-mic.turnDetection.endOfUtteranceDetection.thresholdLevel: is required")]
    [InlineData(
        "turntaking.json",
        "modes.open-mic.turnDetection.endOfUtteranceDetection.timeoutMs",
        "turntaking.json: modes.open-mic.turnDetection.endOfUtteranceDetection.timeoutMs: is required")]
    [InlineData(
        "avatar.json",
        "video.bitrate",
        "avatar.json: video.bitrate: is required")]
    public void AppConfigLoader_rejects_missing_required_nested_session_settings(
        string file,
        string field,
        string expectedError)
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.RemoveJsonValue(file, field);

        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(config.Directory, ModelOpts()));

        Assert.Contains(expectedError, ex.Message);
    }

    [Fact]
    public void AppConfigLoader_aggregates_missing_required_nested_session_settings()
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.RemoveJsonValue(
            "turntaking.json",
            "modes.open-mic.turnDetection.endOfUtteranceDetection.thresholdLevel");
        config.RemoveJsonValue(
            "turntaking.json",
            "modes.open-mic.turnDetection.endOfUtteranceDetection.timeoutMs");
        config.RemoveJsonValue("avatar.json", "video.bitrate");

        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(config.Directory, ModelOpts()));

        Assert.Contains(
            "turntaking.json: modes.open-mic.turnDetection.endOfUtteranceDetection.thresholdLevel: is required",
            ex.Message);
        Assert.Contains(
            "turntaking.json: modes.open-mic.turnDetection.endOfUtteranceDetection.timeoutMs: is required",
            ex.Message);
        Assert.Contains("avatar.json: video.bitrate: is required", ex.Message);
    }

    [Fact]
    public void AppConfigLoader_accepts_default_end_of_utterance_threshold_level()
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue(
            "turntaking.json",
            "modes.open-mic.turnDetection.endOfUtteranceDetection.thresholdLevel",
            "\"default\"");

        var loaded = AppConfigLoader.Load(config.Directory, ModelOpts());

        Assert.Equal(
            "default",
            loaded.Server.TurnTaking.Modes["open-mic"].TurnDetection?
                .EndOfUtteranceDetection?.ThresholdLevel);
    }

    [Theory]
    [InlineData("modes.gated.turnDetection", "{\"type\":\"server_vad\"}", "turntaking.json: modes.gated: manualTurn cannot be combined with turnDetection")]
    [InlineData("modes.open-mic.turnDetection", "null", "turntaking.json: modes.open-mic.turnDetection: is required when manualTurn is false")]
    public void AppConfigLoader_rejects_invalid_turn_mode_combinations(
        string field,
        string jsonValue,
        string expectedError)
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue("turntaking.json", field, jsonValue);

        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(config.Directory, ModelOpts()));

        Assert.Contains(expectedError, ex.Message);
    }

    [Fact]
    public void BuildForAgent_omits_model_and_instructions_but_keeps_voice_avatar_and_audio()
    {
        var config = AppConfigLoader.Load(RepoConfigDir, ModelOpts()).Server;

        var options = SessionOptionsBuilder.BuildForAgent(config);

        Assert.Null(options.Model);
        Assert.Null(options.Instructions);
        Assert.IsType<AzureStandardVoice>(options.Voice);
        Assert.Equal(InputAudioFormat.Pcm16, options.InputAudioFormat);
        Assert.Equal(OutputAudioFormat.Pcm16, options.OutputAudioFormat);
        Assert.Equal(24000, options.InputAudioSamplingRate);
        Assert.NotNull(options.Avatar);
        Assert.False(options.Avatar.Customized);
        Assert.Equal("lisa", options.Avatar.Character);
        Assert.Equal("casual-sitting", options.Avatar.Style);
        Assert.Contains(options.Modalities, m => m.Equals(InteractionModality.Text));
        Assert.Contains(options.Modalities, m => m.Equals(InteractionModality.Audio));
    }

    // ── Task 1: avatar preview / background ───────────────────────────────────

    [Fact]
    public void LoadServerSession_default_avatar_has_preview_false_style_and_no_background()
    {
        var config = AppConfigLoader.Load(RepoConfigDir, ModelOpts()).Server;

        Assert.Equal("lisa", config.Avatar.Character);
        Assert.False(config.Avatar.Preview);
        Assert.Equal("casual-sitting", config.Avatar.Style);
        Assert.Null(config.Avatar.Video?.Background);
    }

    [Fact]
    public void LoadServerSession_background_maps_to_server_config_with_exact_image_url()
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue("avatar.json", "video.background", "{\"imageUrl\":\"https://example.com/bg.jpg\"}");

        var loaded = AppConfigLoader.Load(config.Directory, ModelOpts());

        Assert.Equal("https://example.com/bg.jpg", loaded.Server.Avatar.Video?.Background?.ImageUrl);
    }

    [Fact]
    public void LoadServerSession_preview_true_without_style_produces_null_style()
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue("avatar.json", "preview", "true");
        config.RemoveJsonValue("avatar.json", "style");

        var loaded = AppConfigLoader.Load(config.Directory, ModelOpts());

        Assert.True(loaded.Server.Avatar.Preview);
        Assert.Null(loaded.Server.Avatar.Style);
    }

    [Fact]
    public void AppConfigLoader_rejects_missing_preview_with_exact_field_error()
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.RemoveJsonValue("avatar.json", "preview");

        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(config.Directory, ModelOpts()));

        Assert.Contains("avatar.json: preview: is required", ex.Message);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("\"true\"")]
    public void AppConfigLoader_rejects_non_boolean_preview_with_exact_error(string previewJson)
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue("avatar.json", "preview", previewJson);

        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(config.Directory, ModelOpts()));

        Assert.Contains("avatar.json: preview: must be a boolean", ex.Message);
        Assert.DoesNotContain("avatar.json: json: invalid JSON", ex.Message);
    }

    [Fact]
    public void AppConfigLoader_rejects_style_when_preview_is_true()
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue("avatar.json", "preview", "true");
        // style remains from default config — must be rejected

        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(config.Directory, ModelOpts()));

        Assert.Contains("avatar.json: style: must not be set when preview is true", ex.Message);
    }

    [Theory]
    [InlineData("\"\"")]
    [InlineData("\"   \"")]
    public void AppConfigLoader_rejects_blank_style_when_preview_false(string styleJson)
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue("avatar.json", "style", styleJson);

        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(config.Directory, ModelOpts()));

        Assert.Contains("avatar.json: style: is required when preview is false", ex.Message);
    }

    [Fact]
    public void AppConfigLoader_rejects_missing_style_when_preview_false()
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.RemoveJsonValue("avatar.json", "style");

        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(config.Directory, ModelOpts()));

        Assert.Contains("avatar.json: style: is required when preview is false", ex.Message);
    }

    [Theory]
    [InlineData("customized")]
    [InlineData("Customized")]
    [InlineData("CUSTOMIZED")]
    public void AppConfigLoader_rejects_customized_property_case_insensitively(string propertyName)
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue("avatar.json", propertyName, "false");

        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(config.Directory, ModelOpts()));

        Assert.Contains("avatar.json: customized: is not supported", ex.Message);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("\"not-an-object\"")]
    [InlineData("42")]
    [InlineData("[\"item\"]")]
    [InlineData("true")]
    public void AppConfigLoader_rejects_non_object_background_with_exact_error(string backgroundJson)
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue("avatar.json", "video.background", backgroundJson);

        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(config.Directory, ModelOpts()));

        Assert.Contains("avatar.json: video.background: must be an object", ex.Message);
        Assert.DoesNotContain("avatar.json: json: invalid JSON", ex.Message);
    }

    [Theory]
    [InlineData("{}", "avatar.json: video.background.imageUrl: is required")]
    [InlineData("{\"imageUrl\":\"\"}", "avatar.json: video.background.imageUrl: is required")]
    [InlineData("{\"imageUrl\":\"relative/path.jpg\"}", "avatar.json: video.background.imageUrl: must be an absolute HTTPS URL")]
    [InlineData("{\"imageUrl\":\"http://example.com/bg.jpg\"}", "avatar.json: video.background.imageUrl: must be an absolute HTTPS URL")]
    public void AppConfigLoader_rejects_invalid_background_image_url(string backgroundJson, string expectedError)
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue("avatar.json", "video.background", backgroundJson);

        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(config.Directory, ModelOpts()));

        Assert.Contains(expectedError, ex.Message);
    }

    [Theory]
    [InlineData("{\"imageUrl\":42}")]
    [InlineData("{\"imageUrl\":true}")]
    [InlineData("{\"imageUrl\":[\"item\"]}")]
    [InlineData("{\"imageUrl\":{\"nested\":1}}")]
    public void AppConfigLoader_rejects_non_string_image_url_with_must_be_a_string_error(string backgroundJson)
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue("avatar.json", "video.background", backgroundJson);

        var ex = Assert.Throws<WebConfigValidationException>(() =>
            AppConfigLoader.Load(config.Directory, ModelOpts()));

        Assert.Contains("avatar.json: video.background.imageUrl: must be a string", ex.Message);
        Assert.DoesNotContain("avatar.json: json: invalid JSON", ex.Message);
    }

    // ── Task 2: SDK mapping for avatar background and preview ──────────────────

    [Fact]
    public void Build_background_config_maps_exact_image_url_to_sdk_options()
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue("avatar.json", "video.background", "{\"imageUrl\":\"https://example.com/bg.jpg\"}");

        var loaded = AppConfigLoader.Load(config.Directory, ModelOpts());
        var options = SessionOptionsBuilder.Build(loaded.Server, "instructions");

        Assert.Equal("https://example.com/bg.jpg", options.Avatar.Video.Background.ImageUrl);
    }

    [Fact]
    public void Build_preview_true_maps_customized_false_and_null_style()
    {
        using var config = TemporaryConfig.CopyOf(RepoConfigDir);
        config.SetJsonValue("avatar.json", "preview", "true");
        config.RemoveJsonValue("avatar.json", "style");

        var loaded = AppConfigLoader.Load(config.Directory, ModelOpts());
        var options = SessionOptionsBuilder.Build(loaded.Server, "instructions");

        Assert.False(options.Avatar.Customized);
        Assert.Null(options.Avatar.Style);
    }

    private sealed class TemporaryConfig : IDisposable
    {
        private TemporaryConfig(string directory) => Directory = directory;

        public string Directory { get; }

        public static TemporaryConfig CopyOf(string source)
        {
            var destination = Path.Combine(
                Path.GetDirectoryName(source)!,
                $".test-config-{Guid.NewGuid():N}");
            CopyDirectory(source, destination);

            return new TemporaryConfig(destination);
        }

        public void SetJsonValue(string file, string field, string jsonValue)
        {
            var path = Path.Combine(Directory, file);
            var root = JsonNode.Parse(
                File.ReadAllText(path),
                nodeOptions: null,
                documentOptions: new JsonDocumentOptions
                {
                    CommentHandling = JsonCommentHandling.Skip,
                    AllowTrailingCommas = true
                })!.AsObject();

            var segments = field.Split('.');
            JsonObject current = root;
            foreach (var segment in segments[..^1])
                current = current[segment]!.AsObject();

            current[segments[^1]] = JsonNode.Parse(jsonValue);
            File.WriteAllText(path, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        }

        public void RemoveJsonValue(string file, string field)
        {
            var path = Path.Combine(Directory, file);
            var root = JsonNode.Parse(
                File.ReadAllText(path),
                nodeOptions: null,
                documentOptions: new JsonDocumentOptions
                {
                    CommentHandling = JsonCommentHandling.Skip,
                    AllowTrailingCommas = true
                })!.AsObject();

            var segments = field.Split('.');
            JsonObject current = root;
            foreach (var segment in segments[..^1])
                current = current[segment]!.AsObject();

            current.Remove(segments[^1]);
            File.WriteAllText(path, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        }

        public void Dispose()
        {
            if (System.IO.Directory.Exists(Directory))
                System.IO.Directory.Delete(Directory, recursive: true);
        }

        private static void CopyDirectory(string source, string destination)
        {
            System.IO.Directory.CreateDirectory(destination);

            foreach (var sourceFile in System.IO.Directory.EnumerateFiles(source))
                File.Copy(sourceFile, Path.Combine(destination, Path.GetFileName(sourceFile)));

            foreach (var sourceDirectory in System.IO.Directory.EnumerateDirectories(source))
                CopyDirectory(
                    sourceDirectory,
                    Path.Combine(destination, Path.GetFileName(sourceDirectory)));
        }
    }
}
