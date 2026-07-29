using System.Text.Json;

namespace VoiceLive.Web.Config;

public sealed record VoiceConfig(string Type, string Name);

public sealed record ClientConfig(
    string Region,
    string ApiVersion,
    string Model,
    VoiceConfig Voice,
    JsonElement Avatar,
    string ActiveMode,
    string AgentName,
    string AgentProjectName,
    IReadOnlyList<string> SafeQuestions);

public sealed class WebConfigValidationException(string message) : Exception(message);

public static partial class WebConfigLoader
{
    private static readonly string[] VoiceTypes = ["azure-realtime-native", "azure-standard", "azure-custom", "openai"];
    private static readonly string[] NoiseReductionTypes = ["azure_deep_noise_suppression"];
    private static readonly string[] EchoCancellationTypes = ["server_echo_cancellation"];
    private static readonly string[] TurnDetectionTypes = ["azure_semantic_vad", "server_vad"];
    private static readonly string[] EouThresholdLevels = ["default", "low", "medium", "high"];
    private static readonly string[] EouModels = ["semantic_detection_v1"];
    private static readonly string[] VideoCodecs = ["h264"];
}
