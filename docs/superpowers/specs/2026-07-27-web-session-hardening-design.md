# Web Session Hardening Design

## Scope

Harden the browser-only Voice Live experience without changing the deployment
capacity model. This change will:

- make 24 kHz PCM the fixed application audio contract;
- release browser resources deterministically and support explicit reconnection;
- rate-limit login attempts;
- validate retained server configuration before reporting healthy;
- remove unsupported turn-taking configuration;
- add Playwright coverage for browser lifecycle behavior.

Production scaling, redundancy, and App Service tier changes are out of scope.

## Audio Contract

The application will use 24 kHz, mono, signed 16-bit PCM for browser microphone
input. The sampling rate will be an application constant rather than a user
configuration option.

Remove `inputAudioSamplingRate` from `session.json`, its deserialization records,
and related projections. `SessionOptionsBuilder` will always configure Voice
Live for 24 kHz input. The browser will continue requesting a 24 kHz
`AudioContext`, but it must not assume the browser honors that request. The
audio worklet will resample from its actual global `sampleRate` to the fixed
24 kHz target.

This is appropriate for browser-only usage because the application controls
both ends of the audio transport. Supporting configurable wire formats would
add an unused compatibility surface and allow the browser and service settings
to diverge.

## Browser Session Lifecycle

The browser client will have three externally meaningful states:

1. `connecting`
2. `ready`
3. `disconnected`

All terminal socket closures and fatal setup failures transition to
`disconnected`. Entering that state invokes one idempotent teardown operation
that:

- stops microphone streaming and every acquired media track;
- disconnects all audio nodes;
- closes the audio context;
- closes the WebRTC peer connection;
- clears the ping interval;
- clears the avatar media source;
- closes the WebSocket when it remains open;
- disables interactive controls.

The disconnected UI exposes a Reconnect button. Reconnection creates a fresh
client session with new WebSocket, media, audio, and WebRTC objects. Failed or
closed browser objects are never reused.

Server-enforced idle timeout is treated like any other clean socket closure:
resources are released and the user may reconnect explicitly. Unexpected
closures additionally display an error. Avatar capacity errors remain
non-fatal: only the peer connection is closed, while the voice session and
microphone continue.

## Login Rate Limiting

Use ASP.NET Core rate limiting on `POST /login`.

- Fixed window: one minute.
- Permit limit: five requests.
- Partition key: normalized remote IP address.
- Requests above the limit receive HTTP 429.
- The limiter applies to login attempts regardless of whether credentials are
  correct.
- Health checks, static content, logout, APIs, and WebSocket traffic are not
  placed in this login partition.

This protects the shared operator credential from unrestricted guessing while
keeping the policy understandable and operationally predictable.

## Configuration Validation

Configuration loading must fail before `ConfigState` becomes healthy whenever a
retained setting cannot be safely passed to the Voice Live SDK.

Validation will cover:

- required transcription model when transcription is configured;
- supported noise-reduction type;
- supported turn-detection type;
- valid thresholds and non-negative timing values;
- supported EOU threshold level and positive timeout;
- positive avatar video width, height, and bitrate when provided;
- supported avatar video codec when provided;
- consistency between manual-turn mode and turn-detection configuration.

The health endpoint remains a projection of `ConfigState`: valid configuration
is healthy and invalid configuration is unhealthy. Session creation should not
be the first time configuration validity is discovered.

Tests will exercise each validation category independently and assert actionable
file-and-field error messages.

## Lean Turn-Taking Schema

Remove the unsupported mode-level properties:

- `interruptResponse`
- `gateGatesBargeIn`

Remove them from `ServerTurnModeConfig`, `turntaking.json`, documentation, and
tests. Retain `turnDetection.interruptResponse`, which is implemented by
`SessionOptionsBuilder` for server and Azure semantic VAD.

The existing mode behavior remains:

- `gated` uses manual start/end turn controls;
- `open-mic` and `hybrid` stream continuously and use configured server turn
  detection.

This change does not introduce new hybrid-mode semantics. If hybrid later needs
distinct behavior, it should be designed as an explicit feature rather than
represented by inactive configuration.

## Browser Testing

Add Playwright to `web/frontend`. Tests will run the built UI while installing
mock browser APIs before application startup:

- `WebSocket`
- `navigator.mediaDevices.getUserMedia`
- `AudioContext` and audio worklet-facing objects
- `RTCPeerConnection`
- media-element playback
- timers where deterministic control is required

The initial suite will verify:

- startup reaches ready state and enables the expected controls;
- socket closure stops tracks, closes audio and WebRTC resources, clears
  timers, disables controls, and displays Reconnect;
- Reconnect creates fresh browser resources and can return to ready;
- microphone or avatar setup failure uses the same teardown path;
- avatar-capacity errors remain voice-only and do not disconnect;
- microphone audio is sent under the fixed 24 kHz contract.

The tests focus on browser lifecycle behavior and do not connect to a real Voice
Live service.

## Backend and CI Testing

Backend tests will verify:

- Voice Live session options always use 24 kHz;
- configuration no longer reads a sampling-rate field;
- obsolete mode-level settings are rejected or absent from the supported
  configuration fixtures;
- invalid nested settings make configuration health unhealthy;
- the sixth login attempt from one IP within a minute receives HTTP 429.

CI will retain the existing .NET tests, TypeScript check, and frontend build,
and add a separate Playwright test step. Browser binaries will be installed
using Playwright's supported CI command.

## Out of Scope

- App Service plan changes, autoscaling, or redundancy.
- Full browser-to-ASP.NET-to-Voice-Live integration tests.
- Automatic reconnect or reconnect backoff.
- Entra ID migration.
- Key Vault migration.
- A new hybrid turn-taking interaction model.
