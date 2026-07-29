# VoiceLive.Web

ASP.NET Core backend and frontend host for the Foundry Voice Live avatar MVP.

## Architecture

The web app has four responsibilities:

- **Cookie login**: `/login` authenticates operators with credentials from `Auth:*` configuration.
- **Config endpoint**: `/api/config` reads the repository `config/` JSON files and returns only browser-safe fields needed by the frontend.
- **Voice Live bridge**: `/ws/session` hosts the Voice Live session server-side through the Azure.AI.VoiceLive .NET SDK and bridges browser control/audio messages.
- **Static hosting**: the app serves the built frontend from `wwwroot` with default-file and static-file middleware.

The Voice Live credential never leaves the server. Avatar media still flows browser <-> Azure over WebRTC; the server relays the SDP offer/answer and ICE server metadata described in the phase wire protocol.

## Endpoints

- `GET /api/health` is the anonymous health check. It returns 200 when config is valid and 503 when config failed to load.
- `GET /login` shows the sign-in form.
- `POST /login` signs in with configured credentials.
- `POST /logout` signs out.
- `GET /api/config` requires authentication and returns sanitized config: region, API version, model, voice, avatar settings, active turn-taking mode, agent metadata, and safe questions.
- `WS /ws/session` requires authentication and starts a server-side Voice Live session. Browser binary frames are PCM16 audio; browser JSON controls include `avatar-offer`, `start-turn`, `end-turn`, `barge-in`, `say`, and `ping`. Server JSON events include `ready`, transcripts, speech/avatar state, `avatar-answer`, `response-done`, `avatar-error` (non-fatal; avatar unavailable but voice continues), and `error`.

## Run locally

From the repository root:

```bash
dotnet run --project web/src/VoiceLive.Web
```

Open `http://localhost:5280/` for the default fullscreen avatar landing screen, sign in with the development credentials from `appsettings.Development.json` (`operator` / `rehearsal`), grant microphone permission, then hold **Hold to talk**. The ⚙ gear (top-right) opens the operator/troubleshoot console (`?view=operator`) with status lines, transcript, and safe-question buttons.

For an anonymous health check:

```bash
curl -s http://localhost:5280/api/health; echo
```

If session startup reports an Azure credential error, run `az login` or configure a managed identity.

## Agent mode

By default the web app runs in **model mode** using `VoiceLive:Mode=model` and the `gpt-realtime` model. Model mode works out-of-box with voice and avatar; no model deployment is required.

To connect to a Voice Live agent instead, create the agent in the Azure AI Foundry portal, set its name and project in `config/agent.json`, and set `VoiceLive:Mode=agent` or `VOICELIVE_MODE=agent` before running/deploying. In agent mode the agent owns the model, instructions, and hosted tools; voice, avatar, audio, and turn-taking still come from app config.

Tool/function/MCP events emitted by the agent are logged and shown under "Tool activity" in the operator view **when the session runs in agent mode** (the panel is hidden in model mode, where no tool calls occur). Note: purely hosted tools (e.g. web search, Azure AI Search) run entirely server-side and may not emit a discrete client event.

## How to verify in a browser

Run the app from the repository root:

```bash
ConfigDir=/home/jbergfeld/vcs/foundry-voice-live-avatar/config ASPNETCORE_URLS=http://127.0.0.1:5210 dotnet run --no-launch-profile --project web/src/VoiceLive.Web
```

Open `http://127.0.0.1:5210/` (fullscreen landing) or `http://127.0.0.1:5210/?view=operator` (operator console), sign in, grant microphone permission, then hold **Hold to talk**. Expect avatar video, spoken answer audio, and live/final transcripts. Open `http://127.0.0.1:5210/?view=display` for the passive fullscreen avatar-only view (no microphone).

MVP limitation: every browser tab opens its own `/ws/session`, which creates its own server-side Voice Live session. The operator tab is the complete self-contained experience; a shared operator/display room with one conversation across two screens is future work.

## Security

Operators authenticate with ASP.NET Core cookie auth. Credentials come from `Auth:Username` / `Auth:Password` configuration (`Auth__Username` / `Auth__Password` environment variables or App Service app settings); local development credentials live in `web/src/VoiceLive.Web/appsettings.Development.json`. Unauthenticated HTML requests redirect to `/login`, while unauthenticated `/api/*` and `/ws/*` requests return 401.

The browser never receives the Foundry endpoint or the Voice Live credential. `/ws/session` uses `DefaultAzureCredential` on the server, which becomes the App Service system-assigned managed identity in Azure.

The app also validates WebSocket Origin values, enforces a concurrent-session cap, enforces a maximum inbound message size, and uses ping/pong keepalive. In Production it enables HSTS, HTTPS redirection, and security response headers including CSP.
