# Config schema

The `/config` directory contains the web app's JSON config files. All values below mirror the default config files. Endpoint, API version, and mode are app settings, not `session.json` fields.

## App settings

| Setting | Type | Required | Allowed values / default | Description |
| --- | --- | --- | --- | --- |
| `VoiceLive:Endpoint` | string | Required | Default development value points at the Foundry account endpoint | Voice Live account endpoint, e.g. `https://<account>.services.ai.azure.com`. Environment variable: `VoiceLive__Endpoint`. |
| `VoiceLive:ApiVersion` | string | Required | Default: `2025-10-01` | Voice Live API version. Environment variable: `VoiceLive__ApiVersion`. |
| `VoiceLive:Mode` | string | Required | `model`, `agent`; default: `model` | Session establishment mode. Environment variable: `VoiceLive__Mode`; `VOICELIVE_MODE` can also override it. |
| `Auth:Username` | string | Required | Development default: `operator` | App login username. Environment variable: `Auth__Username`. |
| `Auth:Password` | string | Required | Development default: `rehearsal` | App login password. Environment variable: `Auth__Password`. |

`endpoint`, `apiVersion`, and `mode` are no longer in `config/session.json`. `session.model` is required only in **model** mode; in **agent** mode the Voice Live agent owns the model. Agent name and project live in `config/agent.json`.

Browser audio transport is fixed at 24 kHz mono signed PCM16. The browser audio worklet resamples from the actual browser audio context rate before sending microphone audio.

## `session.json`

| Field | Type | Required | Allowed values / default | Description |
| --- | --- | --- | --- | --- |
| `region` | string | Required | Default: `swedencentral` | Azure region for the Voice Live resource. |
| `model` | string | Required in model mode | Default: `gpt-realtime` | Realtime model name. In agent mode the configured agent owns the model. |
| `voice` | object | Required | Contains `type`, `name` | Voice selection. |
| `voice.type` | string | Required | `azure-realtime-native`, `azure-standard`, `azure-custom`, `openai`; default: `azure-realtime-native` | Voice provider/type. |
| `voice.name` | string | Required | Default: `en-US-AndrewNeural` | Voice name. |
| `inputAudioNoiseReduction` | object | Required | Contains `type` | Input audio noise reduction settings. |
| `inputAudioNoiseReduction.type` | string | Required | Default: `azure_deep_noise_suppression` | Noise reduction mode. |
| `inputAudioEchoCancellation` | object | Required | Contains `type` | Input audio echo cancellation settings. |
| `inputAudioEchoCancellation.type` | string | Required | Default: `server_echo_cancellation` | Echo cancellation mode. |
| `inputAudioTranscription` | object | Required | Contains `model`, `language` | Input audio transcription settings. |
| `inputAudioTranscription.model` | string | Required | Default: `azure-speech` | Transcription model. |
| `inputAudioTranscription.language` | string | Required | Default: `en` | Transcription language. |

## `turntaking.json`

| Field | Type | Required | Allowed values / default | Description |
| --- | --- | --- | --- | --- |
| `activeMode` | string | Required | `open-mic`, `gated`, `hybrid`; default: `gated` | The active turn-taking mode. |
| `modes` | object | Required | Contains `open-mic`, `gated`, `hybrid` | Available turn-taking mode definitions. |
| `modes.open-mic` | object | Required | Contains `manualTurn`, `turnDetection` | Open microphone mode definition. |
| `modes.open-mic.manualTurn` | boolean | Required | Default: `false` | Whether turns are manually committed. |
| `modes.open-mic.turnDetection` | object | Required | Contains semantic VAD settings | Automatic turn detection settings for open mic. |
| `modes.open-mic.turnDetection.type` | string | Required | Default: `azure_semantic_vad` | VAD implementation. |
| `modes.open-mic.turnDetection.threshold` | number | Required | Default: `0.5` | VAD confidence threshold. |
| `modes.open-mic.turnDetection.prefixPaddingMs` | number | Required | Default: `420` | Audio padding before detected speech, in milliseconds. |
| `modes.open-mic.turnDetection.silenceDurationMs` | number | Required | Default: `500` | Silence duration before ending a turn, in milliseconds. |
| `modes.open-mic.turnDetection.interruptResponse` | boolean | Required | Default: `true` | Whether detected speech can interrupt the avatar response. |
| `modes.open-mic.turnDetection.endOfUtteranceDetection` | object | Required | Contains `model`, `thresholdLevel`, `timeoutMs` | Semantic end-of-utterance settings. |
| `modes.open-mic.turnDetection.endOfUtteranceDetection.model` | string | Required | Default: `semantic_detection_v1` | End-of-utterance model. |
| `modes.open-mic.turnDetection.endOfUtteranceDetection.thresholdLevel` | string | Required | Default: `medium` | End-of-utterance threshold level. |
| `modes.open-mic.turnDetection.endOfUtteranceDetection.timeoutMs` | number | Required | Default: `1000` | End-of-utterance timeout in milliseconds. |
| `modes.gated` | object | Required | Contains `manualTurn` | Gated mode definition. |
| `modes.gated.manualTurn` | boolean | Required | Default: `true` | Whether turns are manually committed. |
| `modes.hybrid` | object | Required | Contains `manualTurn`, `turnDetection` | Hybrid mode definition. |
| `modes.hybrid.manualTurn` | boolean | Required | Default: `false` | Whether turns are manually committed. |
| `modes.hybrid.turnDetection` | object | Required | Contains semantic VAD settings | Automatic turn detection settings for hybrid mode. |
| `modes.hybrid.turnDetection.type` | string | Required | Default: `azure_semantic_vad` | VAD implementation. |
| `modes.hybrid.turnDetection.threshold` | number | Required | Default: `0.5` | VAD confidence threshold. |
| `modes.hybrid.turnDetection.silenceDurationMs` | number | Required | Default: `500` | Silence duration before ending a turn, in milliseconds. |
| `modes.hybrid.turnDetection.interruptResponse` | boolean | Required | Default: `true` | Whether detected speech can interrupt the avatar response. |
| `modes.hybrid.turnDetection.endOfUtteranceDetection` | object | Required | Contains `model`, `thresholdLevel`, `timeoutMs` | Semantic end-of-utterance settings. |
| `modes.hybrid.turnDetection.endOfUtteranceDetection.model` | string | Required | Default: `semantic_detection_v1` | End-of-utterance model. |
| `modes.hybrid.turnDetection.endOfUtteranceDetection.thresholdLevel` | string | Required | Default: `medium` | End-of-utterance threshold level. |
| `modes.hybrid.turnDetection.endOfUtteranceDetection.timeoutMs` | number | Required | Default: `1000` | End-of-utterance timeout in milliseconds. |

## `agent.json`

| Field | Type | Required | Allowed values / default | Description |
| --- | --- | --- | --- | --- |
| `agentName` | string | Required for agent mode | Default: `company-direction-avatar` | Voice Live agent name. |
| `agentProjectName` | string | Required for agent mode | Default: `proj-default` | Foundry agent project name (the short project name in the Foundry endpoint path, e.g. `proj-default`). |
| `agentVersion` | string or null | Optional | Default: `null` | Optional pinned agent version. |
| `conversationResumePolicy` | string | Required | `resume`, `fresh`; default: `resume` | Whether conversations resume or start fresh. |
| `groundingStrategy` | string | Required | `pack`, `rag`, `both`; default: `pack` | Grounding source strategy. |
| `safeQuestions` | string array | Required | Default: two configured fallback questions | Safe redirect questions the avatar can use. |
| `safeQuestions[]` | string | Required | Defaults: `Let's refocus - what is our single most important priority this year?`, `What does this direction mean for our customers?` | Individual safe redirect question. |

## `avatar.json`

| Field | Type | Required | Allowed values / default | Description |
| --- | --- | --- | --- | --- |
| `character` | string | Required | Default: `lisa` | Avatar character. |
| `preview` | boolean | Required | Default: `false`; local-only flag | Local preview-avatar flag. Preview avatars omit style; this field is not sent to Voice Live. Must be a boolean; missing, `null`, or non-boolean values are invalid. |
| `style` | string | Required when `preview` is `false`; forbidden when `preview` is `true` | Default: `casual-sitting` | Avatar style. Must be omitted entirely when `preview` is `true`; any `style` property present alongside `preview: true` is rejected. |
| `video` | object | Required | Contains `resolution`, `bitrate`, `codec`, `background` | Video output settings. |
| `video.resolution` | object | Required | Contains `width`, `height` | Video resolution. |
| `video.resolution.width` | number | Required | Default: `1920` | Video width in pixels. |
| `video.resolution.height` | number | Required | Default: `1080` | Video height in pixels. |
| `video.bitrate` | number | Required | Default: `2000000` | Video bitrate in bits per second. |
| `video.codec` | string | Required | Default: `h264` | Video codec. |
| `video.background` | object | Optional | | Background settings for the avatar video. Must be an object if present; null or any non-object value is invalid. |
| `video.background.imageUrl` | string | Required within `video.background` | Absolute HTTPS URL | Background image URL. Must be a string and an absolute HTTPS URL. Non-string values (numbers, booleans, arrays, objects) are invalid. |

## Validation rules

- All fields marked required above must be present and non-empty where applicable.
- `VoiceLive:Mode` / `VOICELIVE_MODE` must be one of `model` or `agent`; invalid values fail fast at startup.
- `VoiceLive:Endpoint` and `VoiceLive:ApiVersion` must be configured.
- `session.json` must not carry `endpoint`, `apiVersion`, or `mode`; those values come from app settings.
- `session.json.model` is required in model mode and optional in agent mode.
- `session.json.voice.type` must be one of `azure-realtime-native`, `azure-standard`, `azure-custom`, or `openai`.
- `turntaking.json.activeMode` must be one of `open-mic`, `gated`, or `hybrid`, and the matching entry must exist in `modes`.
- `agent.json.agentName` and `agent.json.agentProjectName` are required in agent mode.
- `agent.json.groundingStrategy` must be one of `pack`, `rag`, or `both`.
- `agent.json.conversationResumePolicy` must be one of `resume` or `fresh`.
- Unknown values for `voice.type`, `turntaking.activeMode`, `agent.groundingStrategy`, or `agent.conversationResumePolicy` fail fast at startup.
- `avatar.json.preview` is a local preview-avatar flag (required, boolean); preview avatars omit style and this field is not sent to Voice Live; missing, `null`, or non-boolean values are invalid.
- `avatar.json.style` is required when `preview` is `false` and must not be present when `preview` is `true`; the presence of any `style` property alongside `preview: true` is rejected.
- `avatar.json.customized` is not supported; the app always creates non-customized avatars regardless of config.
- `avatar.json.video.background` must be an object if present; null or any non-object value is invalid.
- `avatar.json.video.background.imageUrl` is required within `video.background`, must be a string (numbers, booleans, arrays, and objects are invalid), and must be an absolute HTTPS URL.
