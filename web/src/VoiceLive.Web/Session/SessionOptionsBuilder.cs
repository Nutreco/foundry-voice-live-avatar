using Azure.AI.VoiceLive;
using VoiceLive.Web.Config;

namespace VoiceLive.Web.Session;

public static class SessionOptionsBuilder
{
    public const int BrowserPcmSamplingRate = 24_000;

    public static VoiceLiveSessionOptions Build(ServerSessionConfig config, string instructions)
    {
        var options = BuildCommon(config);
        options.Model = config.Model;
        options.Instructions = instructions;
        return options;
    }

    public static VoiceLiveSessionOptions BuildForAgent(ServerSessionConfig config)
        => BuildCommon(config); // agent owns Model + Instructions

    private static VoiceLiveSessionOptions BuildCommon(ServerSessionConfig config)
    {
        var options = new VoiceLiveSessionOptions
        {
            Voice = BuildVoice(config.Voice),
            TurnDetection = BuildTurnDetection(config.TurnTaking),
            InputAudioFormat = InputAudioFormat.Pcm16,
            OutputAudioFormat = OutputAudioFormat.Pcm16,
            InputAudioSamplingRate = BrowserPcmSamplingRate,
            Avatar = BuildAvatar(config.Avatar),
        };

        if (config.InputAudioNoiseReduction is not null)
            options.InputAudioNoiseReduction = new AudioNoiseReduction(new AudioNoiseReductionType(config.InputAudioNoiseReduction.Type));
        if (config.InputAudioEchoCancellation is not null && UsesTurnDetection(config.TurnTaking))
            options.InputAudioEchoCancellation = new AudioEchoCancellation();
        if (config.InputAudioTranscription is not null && UsesTurnDetection(config.TurnTaking))
        {
            options.InputAudioTranscription = new AudioInputTranscriptionOptions(new AudioInputTranscriptionOptionsModel(config.InputAudioTranscription.Model))
            {
                Language = config.InputAudioTranscription.Language
            };
        }

        options.Modalities.Clear();
        options.Modalities.Add(InteractionModality.Text);
        options.Modalities.Add(InteractionModality.Audio);
        return options;
    }

    private static VoiceProvider BuildVoice(ServerVoiceConfig voice) => voice.Type switch
    {
        "azure-standard" or "azure-realtime-native" => BuildAzureStandardVoice(voice),
        "openai" => new OpenAIVoice(new OAIVoice(voice.Name)),
        "azure-custom" => throw new WebConfigValidationException("session.json: voice.type 'azure-custom' is not supported yet because config has no custom voice endpoint id."),
        _ => throw new WebConfigValidationException($"session.json: voice.type '{voice.Type}' is not supported.")
    };

    private static AzureStandardVoice BuildAzureStandardVoice(ServerVoiceConfig voice)
    {
        var azureVoice = new AzureStandardVoice(voice.Name);
        if (voice.Rate is not null) azureVoice.Rate = voice.Rate;
        if (voice.Style is not null) azureVoice.Style = voice.Style;
        if (voice.Temperature is not null) azureVoice.Temperature = (float)voice.Temperature.Value;
        return azureVoice;
    }

    private static TurnDetection BuildTurnDetection(ServerTurnTakingConfig turnTaking)
    {
        var mode = turnTaking.ActiveModeConfig;
        if (mode.ManualTurn || mode.TurnDetection is null) return new NoTurnDetection();

        return mode.TurnDetection.Type switch
        {
            "azure_semantic_vad" => BuildAzureSemanticVad(mode.TurnDetection),
            "server_vad" => BuildServerVad(mode.TurnDetection),
            _ => throw new WebConfigValidationException($"turntaking.json: turnDetection.type '{mode.TurnDetection.Type}' is not supported.")
        };
    }

    private static bool UsesTurnDetection(ServerTurnTakingConfig turnTaking)
    {
        var mode = turnTaking.ActiveModeConfig;
        return !mode.ManualTurn && mode.TurnDetection is not null;
    }

    private static AzureSemanticVadTurnDetection BuildAzureSemanticVad(ServerTurnDetectionConfig config)
    {
        var vad = new AzureSemanticVadTurnDetection();
        ApplyCommonVad(vad, config);
        return vad;
    }

    private static ServerVadTurnDetection BuildServerVad(ServerTurnDetectionConfig config)
    {
        var vad = new ServerVadTurnDetection();
        ApplyCommonVad(vad, config);
        return vad;
    }

    private static void ApplyCommonVad(TurnDetection vad, ServerTurnDetectionConfig config)
    {
        switch (vad)
        {
            case AzureSemanticVadTurnDetection semantic:
                if (config.Threshold is not null) semantic.Threshold = (float)config.Threshold.Value;
                if (config.PrefixPaddingMs is not null) semantic.PrefixPadding = TimeSpan.FromMilliseconds(config.PrefixPaddingMs.Value);
                if (config.SilenceDurationMs is not null) semantic.SilenceDuration = TimeSpan.FromMilliseconds(config.SilenceDurationMs.Value);
                if (config.InterruptResponse is not null) semantic.InterruptResponse = config.InterruptResponse.Value;
                if (config.EndOfUtteranceDetection is not null) semantic.EndOfUtteranceDetection = BuildEou(config.EndOfUtteranceDetection);
                break;
            case ServerVadTurnDetection server:
                if (config.Threshold is not null) server.Threshold = (float)config.Threshold.Value;
                if (config.PrefixPaddingMs is not null) server.PrefixPadding = TimeSpan.FromMilliseconds(config.PrefixPaddingMs.Value);
                if (config.SilenceDurationMs is not null) server.SilenceDuration = TimeSpan.FromMilliseconds(config.SilenceDurationMs.Value);
                if (config.InterruptResponse is not null) server.InterruptResponse = config.InterruptResponse.Value;
                if (config.EndOfUtteranceDetection is not null) server.EndOfUtteranceDetection = BuildEou(config.EndOfUtteranceDetection);
                break;
        }
    }

    private static AzureSemanticEouDetection BuildEou(ServerEouDetectionConfig config)
    {
        var eou = new AzureSemanticEouDetection();
        if (config.ThresholdLevel is not null) eou.ThresholdLevel = new EouThresholdLevel(config.ThresholdLevel);
        if (config.TimeoutMs is not null) eou.Timeout = TimeSpan.FromMilliseconds(config.TimeoutMs.Value);
        return eou;
    }

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
                Resolution = new VideoResolution(config.Video.Resolution.Width, config.Video.Resolution.Height),
                Background = config.Video.Background is not null
                    ? new VideoBackground
                    {
                        Color = config.Video.Background.Color,
                        ImageUrl = config.Video.Background.ImageUrl
                    }
                    : null
            };
            if (config.Video.Background is not null)
                avatar.Video.Background = new VideoBackground { ImageUrl = config.Video.Background.ImageUrl };
        }
        return avatar;
    }
}
