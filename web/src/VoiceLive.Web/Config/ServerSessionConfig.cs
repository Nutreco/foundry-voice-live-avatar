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
    int InputAudioSamplingRate,
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
    bool? GateGatesBargeIn = null,
    bool? InterruptResponse = null,
    ServerTurnDetectionConfig? TurnDetection = null);

public sealed record ServerTurnTakingConfig(string ActiveMode, IReadOnlyDictionary<string, ServerTurnModeConfig> Modes)
{
    public ServerTurnModeConfig ActiveModeConfig => Modes[ActiveMode];
}

public sealed record ServerVideoResolutionConfig(int Width, int Height);
public sealed record ServerVideoBackgroundConfig(string Color, string ImageUrl);
public sealed record ServerVideoConfig(ServerVideoResolutionConfig Resolution, int? Bitrate = null, string? Codec = null, ServerVideoBackgroundConfig? Background = null);
public sealed record ServerAvatarConfig(string Character, string Style, bool Customized, ServerVideoConfig? Video = null);
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

        if (session.InputAudioSamplingRate <= 0)
            errors.Add("session.json: inputAudioSamplingRate: must be greater than zero");

        RequireServer(turn.ActiveMode, "turntaking.json", "activeMode", errors);
        if (turn.Modes is null || turn.Modes.Count == 0)
            errors.Add("turntaking.json: modes: is required");
        else if (!string.IsNullOrWhiteSpace(turn.ActiveMode) && !turn.Modes.ContainsKey(turn.ActiveMode!))
            errors.Add($"turntaking.json: activeMode: '{turn.ActiveMode}' is not present in modes");

        RequireServer(avatar.Character, "avatar.json", "character", errors);
        // RequireServer(avatar.Style, "avatar.json", "style", errors);

        RequireServer(agent.AgentName, "agent.json", "agentName", errors);
        RequireServer(agent.AgentProjectName, "agent.json", "agentProjectName", errors);
        if (agent.SafeQuestions is null) errors.Add("agent.json: safeQuestions: is required");

        if (errors.Count > 0)
            return (null, null);

        var model = session.Model ?? "";
        var server = new ServerSessionConfig(
            env.Endpoint,
            session.Region!,
            env.ApiVersion,
            model,
            new ServerVoiceConfig(session.Voice!.Type!, session.Voice.Name!, session.Voice.Temperature, session.Voice.Rate, session.Voice.Style),
            session.InputAudioSamplingRate,
            session.InputAudioNoiseReduction is null ? null : new ServerNoiseReductionConfig(session.InputAudioNoiseReduction.Type!),
            session.InputAudioEchoCancellation is null ? null : new ServerEchoCancellationConfig(session.InputAudioEchoCancellation.Type!),
            session.InputAudioTranscription is null ? null : new ServerTranscriptionConfig(session.InputAudioTranscription.Model!, session.InputAudioTranscription.Language),
            new ServerTurnTakingConfig(turn.ActiveMode!, turn.Modes!),
            new ServerAvatarConfig(avatar.Character!, avatar.Style!, avatar.Customized, avatar.Video),
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

    private sealed record ServerSessionFile(
        string? Region,
        string? Model,
        ServerVoiceFile? Voice,
        int InputAudioSamplingRate,
        ServerNoiseReductionFile? InputAudioNoiseReduction,
        ServerEchoCancellationFile? InputAudioEchoCancellation,
        ServerTranscriptionFile? InputAudioTranscription);

    private sealed record ServerVoiceFile(string? Type, string? Name, double? Temperature = null, string? Rate = null, string? Style = null);
    private sealed record ServerNoiseReductionFile(string? Type);
    private sealed record ServerEchoCancellationFile(string? Type);
    private sealed record ServerTranscriptionFile(string? Model, string? Language = null);
    private sealed record ServerTurnTakingFile(string? ActiveMode, Dictionary<string, ServerTurnModeConfig>? Modes);
    private sealed record ServerAvatarFile(string? Character, string? Style, bool Customized, ServerVideoConfig? Video = null);
    private sealed record ServerAgentFile(string? AgentName, string? AgentProjectName, IReadOnlyList<string>? SafeQuestions);
}
