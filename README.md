# foundry-voice-live-avatar

A single ASP.NET Core web app for a Microsoft Foundry Voice Live avatar. The server hosts the Voice Live session and bridges browser audio/control messages over WebSockets; the browser renders the avatar with `@azure/ai-voicelive`.

- [`/web`](./web) - ASP.NET Core app, frontend assets, cookie login, server-side Voice Live bridge, and static hosting.
- [`/config`](./config) - runtime avatar, audio, voice, agent metadata, safe-question, and grounding configuration shipped with the app.
- [`/infra`](./infra) - Azure App Service, Azure AI Foundry, Application Insights, and RBAC infrastructure for `azd`.
- [`/docs`](./docs) - config schema, runbook, and rehearsal checklist.

The deployment model is Azure App Service on Linux with a system-assigned managed identity. `azd up` provisions the Foundry account and project, App Service, Log Analytics, Application Insights, and RBAC so the app can call Voice Live without API keys or a Microsoft Entra app registration.

The trust model is app-level ASP.NET Core cookie authentication. Operators sign in with `Auth:Username` / `Auth:Password`; unauthenticated HTML requests redirect to `/login`, while unauthenticated `/api/*` and `/ws/*` requests return 401. The browser never receives an Azure token: the server holds `DefaultAzureCredential` / managed identity and talks to Voice Live over the `/ws/session` bridge.

Design spec: `docs/superpowers/specs/2026-07-22-voice-live-avatar-design.md`.

## Deploy (azd)

Prerequisites: Azure CLI + azd, and an Azure subscription. No Entra app registration required.

1. `az login && azd auth login`
2. `azd env new <name>` and `azd env set AZURE_LOCATION swedencentral`
3. `azd env set AUTH_USERNAME <user>` and `azd env set AUTH_PASSWORD <password>`
4. `azd up` — provisions Foundry (account + project), App Service, and Application Insights; builds the frontend (prebuild hook); and deploys the app. It runs in MODEL mode (`gpt-realtime`) out-of-box.
5. Open the printed URL, sign in with your `AUTH_USERNAME` / `AUTH_PASSWORD`, and start a session.

### Agent mode (optional)

Create a Voice Live agent in the Azure AI Foundry portal, set its name in `config/agent.json`, run `azd env set VOICELIVE_MODE agent`, then `azd up` again. The `postprovision` hook lists any existing agents and prints these steps.

If `DOTNETCORE|10.0` is unavailable in your region, run `azd env set LINUX_FX_VERSION ""` and deploy self-contained (see `docs/runbook.md`).

## Run locally

Run the web app from the repository root:

```bash
dotnet run --project web/src/VoiceLive.Web
```

Open `http://localhost:5280/` for the fullscreen avatar landing screen (talk to the avatar with **Hold to talk**; the ⚙ gear opens the operator/troubleshoot view). Or open `http://localhost:5280/?view=operator` directly for the operator console. Sign in with the development credentials `operator` / `rehearsal`. The frontend is built automatically by the MSBuild `BuildFrontend` target.
