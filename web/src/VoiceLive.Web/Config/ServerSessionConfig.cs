using System.Text.Json;

namespace VoiceLive.Web.Config;

public sealed record ServerVoiceConfig(string Type, string Name, double? Temperature = null, string? Rate = null, string? Style = null);
public sealed record ServerNoiseReductionConfig(string Type);
public sealed record ServerEchoCancellationConfig(string Type);
public sealed record ServerTranscriptionConfig(string Model, string? Language = null);

public sealed record ServerSessionConfig(
    string Endpoint,
    string Region,
    string ApiVersion,
    string Model,
    ServerVoiceConfig Voice,
    ServerNoiseReductionConfig? InputAudioNoiseReduction,
    ServerEchoCancellationConfig? InputAudioEchoCancellation,
    ServerTranscriptionConfig? InputAudioTranscription,
    ServerTurnTakingConfig TurnTaking,
    ServerAvatarConfig Avatar,
    ServerAgentConfig Agent,
    string Mode);

public sealed record ServerEouDetectionConfig(string Model, string? ThresholdLevel = null, int? TimeoutMs = null);
public sealed record ServerTurnDetectionConfig(
    string Type,
    double? Threshold = null,
    int? PrefixPaddingMs = null,
    int? SilenceDurationMs = null,
    bool? InterruptResponse = null,
    ServerEouDetectionConfig? EndOfUtteranceDetection = null);

public sealed record ServerTurnModeConfig(
    bool ManualTurn = false,
    ServerTurnDetectionConfig? TurnDetection = null);

public sealed record ServerTurnTakingConfig(string ActiveMode, IReadOnlyDictionary<string, ServerTurnModeConfig> Modes)
{
    public ServerTurnModeConfig ActiveModeConfig => Modes[ActiveMode];
}

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
public sealed record ServerAgentConfig(string AgentName, string AgentProjectName, IReadOnlyList<string> SafeQuestions);

public static partial class WebConfigLoader
{
    private static readonly JsonSerializerOptions ServerOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    public static (ServerSessionConfig? server, ClientConfig? client) BuildProjections(
        string dir,
        VoiceLiveOptions env,
        string mode,
        List<string> errors)
    {
        var session = ReadServer<ServerSessionFile>(dir, "session.json", errors);
        var turn = ReadServer<ServerTurnTakingFile>(dir, "turntaking.json", errors);
        var (avatar, avatarElement) = ReadAvatarServer(dir, errors);
        var agent = ReadServer<ServerAgentFile>(dir, "agent.json", errors);

        if (session is null || turn is null || avatar is null || avatarElement is null || agent is null)
            return (null, null);

        RequireServer(session.Region, "session.json", "region", errors);
        if (mode == SessionModeResolver.Model)
            RequireServer(session.Model, "session.json", "model", errors, "is required in model mode");

        if (session.Voice is null)
        {
            errors.Add("session.json: voice: is required");
        }
        else
        {
            RequireServer(session.Voice.Type, "session.json", "voice.type", errors);
            RequireServer(session.Voice.Name, "session.json", "voice.name", errors);
            if (!string.IsNullOrWhiteSpace(session.Voice.Type) && !VoiceTypes.Contains(session.Voice.Type))
                errors.Add($"session.json: voice.type: '{session.Voice.Type}' is not one of {string.Join(", ", VoiceTypes)}");
        }

        RequireServer(turn.ActiveMode, "turntaking.json", "activeMode", errors);
        if (turn.Modes is null || turn.Modes.Count == 0)
            errors.Add("turntaking.json: modes: is required");
        else if (!string.IsNullOrWhiteSpace(turn.ActiveMode) && !turn.Modes.ContainsKey(turn.ActiveMode!))
            errors.Add($"turntaking.json: activeMode: '{turn.ActiveMode}' is not present in modes");

        RequireServer(avatar.Character, "avatar.json", "character", errors);
        if (avatar.Preview == false)
            RequireServer(avatar.Style, "avatar.json", "style", errors, "is required when preview is false");

        RequireServer(agent.AgentName, "agent.json", "agentName", errors);
        RequireServer(agent.AgentProjectName, "agent.json", "agentProjectName", errors);
        if (agent.SafeQuestions is null) errors.Add("agent.json: safeQuestions: is required");

        ValidateSessionSettings(session, errors);
        ValidateTurnTakingSettings(turn, errors);
        ValidateAvatarSettings(avatar, errors);

        if (errors.Count > 0)
            return (null, null);

        var model = session.Model ?? "";
        var server = new ServerSessionConfig(
            env.Endpoint,
            session.Region!,
            env.ApiVersion,
            model,
            new ServerVoiceConfig(session.Voice!.Type!, session.Voice.Name!, session.Voice.Temperature, session.Voice.Rate, session.Voice.Style),
            session.InputAudioNoiseReduction is null ? null : new ServerNoiseReductionConfig(session.InputAudioNoiseReduction.Type!),
            session.InputAudioEchoCancellation is null ? null : new ServerEchoCancellationConfig(session.InputAudioEchoCancellation.Type!),
            session.InputAudioTranscription is null ? null : new ServerTranscriptionConfig(session.InputAudioTranscription.Model!, session.InputAudioTranscription.Language),
            new ServerTurnTakingConfig(turn.ActiveMode!, turn.Modes!),
            new ServerAvatarConfig(
                avatar.Character!,
                avatar.Style,
                avatar.Preview ?? false,
                avatar.Video is null ? null : new ServerVideoConfig(
                    avatar.Video.Resolution!,
                    avatar.Video.Bitrate,
                    avatar.Video.Codec,
                    BuildBackground(avatar.Video.Background))),
            new ServerAgentConfig(agent.AgentName!, agent.AgentProjectName!, agent.SafeQuestions!),
            mode);

        var client = new ClientConfig(
            session.Region!,
            env.ApiVersion,
            model,
            new VoiceConfig(session.Voice!.Type!, session.Voice.Name!),
            avatarElement.Value,
            turn.ActiveMode!,
            agent.AgentName!,
            agent.AgentProjectName!,
            agent.SafeQuestions!);

        return (server, client);
    }

    private static T? ReadServer<T>(string dir, string file, List<string> errors) where T : class
    {
        var path = Path.Combine(dir, file);
        if (!File.Exists(path))
        {
            errors.Add($"{file}: file: not found at {path}");
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<T>(File.ReadAllText(path), ServerOpts)
                ?? throw new JsonException("null document");
        }
        catch (JsonException ex)
        {
            errors.Add($"{file}: json: invalid JSON - {ex.Message}");
            return null;
        }
    }

    private static (ServerAvatarFile? avatar, JsonElement? element) ReadAvatarServer(string dir, List<string> errors)
    {
        var path = Path.Combine(dir, "avatar.json");
        if (!File.Exists(path))
        {
            errors.Add($"avatar.json: file: not found at {path}");
            return (null, null);
        }

        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path), new JsonDocumentOptions
            {
                CommentHandling = JsonCommentHandling.Skip,
                AllowTrailingCommas = true
            });
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
            {
                errors.Add("avatar.json: root: must be an object");
                return (null, null);
            }

            var root = doc.RootElement;
            var errorsBeforeRawChecks = errors.Count;

            // Reject removed 'customized' property (case-insensitive)
            foreach (var prop in root.EnumerateObject())
            {
                if (prop.Name.Equals("customized", StringComparison.OrdinalIgnoreCase))
                {
                    errors.Add("avatar.json: customized: is not supported");
                    break;
                }
            }

            // Check 'preview' presence and 'style' exclusivity
            bool hasPreview = false;
            bool previewIsTrue = false;
            foreach (var prop in root.EnumerateObject())
            {
                if (prop.Name.Equals("preview", StringComparison.OrdinalIgnoreCase))
                {
                    hasPreview = true;
                    var kind = prop.Value.ValueKind;
                    if (kind == JsonValueKind.True)
                        previewIsTrue = true;
                    else if (kind != JsonValueKind.False)
                        errors.Add("avatar.json: preview: must be a boolean");
                    break;
                }
            }

            if (!hasPreview)
                errors.Add("avatar.json: preview: is required");

            if (hasPreview && previewIsTrue)
            {
                bool hasStyle = root.EnumerateObject()
                    .Any(p => p.Name.Equals("style", StringComparison.OrdinalIgnoreCase));
                if (hasStyle)
                    errors.Add("avatar.json: style: must not be set when preview is true");
            }

            // Reject non-object video.background
            foreach (var prop in root.EnumerateObject())
            {
                if (!prop.Name.Equals("video", StringComparison.OrdinalIgnoreCase) ||
                    prop.Value.ValueKind != JsonValueKind.Object)
                    continue;
                foreach (var videoProp in prop.Value.EnumerateObject())
                {
                    if (!videoProp.Name.Equals("background", StringComparison.OrdinalIgnoreCase))
                        continue;
                    if (videoProp.Value.ValueKind != JsonValueKind.Object)
                        errors.Add("avatar.json: video.background: must be an object");
                    break;
                }
                break;
            }

            if (errors.Count > errorsBeforeRawChecks)
                return (null, null);

            var avatar = doc.RootElement.Deserialize<ServerAvatarFile>(ServerOpts)
                ?? throw new JsonException("null document");
            return (avatar, doc.RootElement.Clone());
        }
        catch (JsonException ex)
        {
            errors.Add($"avatar.json: json: invalid JSON - {ex.Message}");
            return (null, null);
        }
    }

    private static void RequireServer(string? value, string file, string field, List<string> errors, string message = "is required")
    {
        if (string.IsNullOrWhiteSpace(value)) errors.Add($"{file}: {field}: {message}");
    }

    private static void ValidateSessionSettings(ServerSessionFile session, List<string> errors)
    {
        if (session.InputAudioTranscription is not null)
            RequireServer(
                session.InputAudioTranscription.Model,
                "session.json",
                "inputAudioTranscription.model",
                errors);

        if (session.InputAudioNoiseReduction is not null)
            ValidateSupportedValue(
                session.InputAudioNoiseReduction.Type,
                "session.json",
                "inputAudioNoiseReduction.type",
                NoiseReductionTypes,
                errors);

        if (session.InputAudioEchoCancellation is not null)
            ValidateSupportedValue(
                session.InputAudioEchoCancellation.Type,
                "session.json",
                "inputAudioEchoCancellation.type",
                EchoCancellationTypes,
                errors);
    }

    private static void ValidateTurnTakingSettings(ServerTurnTakingFile turn, List<string> errors)
    {
        if (turn.Modes is null)
            return;

        foreach (var (modeName, mode) in turn.Modes)
        {
            var modeField = $"modes.{modeName}";
            if (mode is null)
            {
                errors.Add($"turntaking.json: {modeField}: is required");
                continue;
            }

            if (mode.ManualTurn && mode.TurnDetection is not null)
                errors.Add($"turntaking.json: {modeField}: manualTurn cannot be combined with turnDetection");
            else if (!mode.ManualTurn && mode.TurnDetection is null)
                errors.Add($"turntaking.json: {modeField}.turnDetection: is required when manualTurn is false");

            if (mode.TurnDetection is not null)
                ValidateTurnDetection(mode.TurnDetection, $"{modeField}.turnDetection", errors);
        }
    }

    private static void ValidateTurnDetection(
        ServerTurnDetectionConfig turnDetection,
        string field,
        List<string> errors)
    {
        ValidateSupportedValue(
            turnDetection.Type,
            "turntaking.json",
            $"{field}.type",
            TurnDetectionTypes,
            errors);

        if (turnDetection.Threshold is < 0 or > 1)
            errors.Add($"turntaking.json: {field}.threshold: must be between 0 and 1");
        if (turnDetection.PrefixPaddingMs is < 0)
            errors.Add($"turntaking.json: {field}.prefixPaddingMs: must be non-negative");
        if (turnDetection.SilenceDurationMs is < 0)
            errors.Add($"turntaking.json: {field}.silenceDurationMs: must be non-negative");

        if (turnDetection.EndOfUtteranceDetection is not null)
            ValidateEouDetection(
                turnDetection.EndOfUtteranceDetection,
                $"{field}.endOfUtteranceDetection",
                errors);
    }

    private static void ValidateEouDetection(
        ServerEouDetectionConfig eou,
        string field,
        List<string> errors)
    {
        ValidateSupportedValue(eou.Model, "turntaking.json", $"{field}.model", EouModels, errors);

        ValidateSupportedValue(
            eou.ThresholdLevel,
            "turntaking.json",
            $"{field}.thresholdLevel",
            EouThresholdLevels,
            errors);

        if (eou.TimeoutMs is null)
            errors.Add($"turntaking.json: {field}.timeoutMs: is required");
        else if (eou.TimeoutMs <= 0)
            errors.Add($"turntaking.json: {field}.timeoutMs: must be positive");
    }

    private static void ValidateAvatarSettings(ServerAvatarFile avatar, List<string> errors)
    {
        if (avatar.Video is null)
            return;

        if (avatar.Video.Resolution is null)
        {
            errors.Add("avatar.json: video.resolution: is required");
        }
        else
        {
            if (avatar.Video.Resolution.Width <= 0)
                errors.Add("avatar.json: video.resolution.width: must be positive");
            if (avatar.Video.Resolution.Height <= 0)
                errors.Add("avatar.json: video.resolution.height: must be positive");
        }

        if (avatar.Video.Bitrate is null)
            errors.Add("avatar.json: video.bitrate: is required");
        else if (avatar.Video.Bitrate <= 0)
            errors.Add("avatar.json: video.bitrate: must be positive");

        if (avatar.Video.Codec is not null)
            ValidateSupportedValue(
                avatar.Video.Codec,
                "avatar.json",
                "video.codec",
                VideoCodecs,
                errors);

        if (avatar.Video.Background is { } bgElement && bgElement.ValueKind == JsonValueKind.Object)
        {
            JsonElement? imageUrlElement = null;
            foreach (var prop in bgElement.EnumerateObject())
            {
                if (prop.Name.Equals("imageUrl", StringComparison.OrdinalIgnoreCase))
                {
                    imageUrlElement = prop.Value;
                    break;
                }
            }

            if (imageUrlElement is null)
            {
                errors.Add("avatar.json: video.background.imageUrl: is required");
            }
            else if (imageUrlElement.Value.ValueKind != JsonValueKind.String)
            {
                errors.Add("avatar.json: video.background.imageUrl: must be a string");
            }
            else
            {
                var imageUrl = imageUrlElement.Value.GetString();
                if (string.IsNullOrWhiteSpace(imageUrl))
                    errors.Add("avatar.json: video.background.imageUrl: is required");
                else if (!Uri.TryCreate(imageUrl, UriKind.Absolute, out var uri) ||
                         uri.Scheme != Uri.UriSchemeHttps)
                    errors.Add("avatar.json: video.background.imageUrl: must be an absolute HTTPS URL");
            }
        }
    }

    private static ServerVideoBackgroundConfig? BuildBackground(JsonElement? background)
    {
        if (background is null || background.Value.ValueKind != JsonValueKind.Object)
            return null;
        foreach (var prop in background.Value.EnumerateObject())
        {
            if (prop.Name.Equals("imageUrl", StringComparison.OrdinalIgnoreCase) &&
                prop.Value.ValueKind == JsonValueKind.String)
            {
                var imageUrl = prop.Value.GetString();
                return imageUrl is not null ? new ServerVideoBackgroundConfig(imageUrl) : null;
            }
        }
        return null;
    }

    private static void ValidateSupportedValue(
        string? value,
        string file,
        string field,
        IReadOnlyCollection<string> supported,
        List<string> errors)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            errors.Add($"{file}: {field}: is required");
        }
        else if (!supported.Contains(value))
        {
            errors.Add($"{file}: {field}: '{value}' is not supported; supported: {string.Join(", ", supported)}");
        }
    }

    private sealed record ServerSessionFile(
        string? Region,
        string? Model,
        ServerVoiceFile? Voice,
        ServerNoiseReductionFile? InputAudioNoiseReduction,
        ServerEchoCancellationFile? InputAudioEchoCancellation,
        ServerTranscriptionFile? InputAudioTranscription);

    private sealed record ServerVoiceFile(string? Type, string? Name, double? Temperature = null, string? Rate = null, string? Style = null);
    private sealed record ServerNoiseReductionFile(string? Type);
    private sealed record ServerEchoCancellationFile(string? Type);
    private sealed record ServerTranscriptionFile(string? Model, string? Language = null);
    private sealed record ServerTurnTakingFile(string? ActiveMode, Dictionary<string, ServerTurnModeConfig>? Modes);
    private sealed record ServerAvatarFile(string? Character, string? Style, bool? Preview, ServerAvatarVideoFile? Video = null);
    private sealed record ServerAvatarVideoFile(
        ServerVideoResolutionConfig? Resolution,
        int? Bitrate = null,
        string? Codec = null,
        JsonElement? Background = null);
    private sealed record ServerAgentFile(string? AgentName, string? AgentProjectName, IReadOnlyList<string>? SafeQuestions);
}
