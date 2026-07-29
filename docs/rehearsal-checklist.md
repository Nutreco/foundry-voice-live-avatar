# Rehearsal Checklist

## Day before

- [ ] Confirm the Azure AI Foundry resource is in `swedencentral`.
- [ ] Confirm app/managed-identity RBAC: `Cognitive Services User` + `Foundry User` / `Azure AI User` on the account/project scope.
- [ ] Run `az login` on the operator machine for local runs, or confirm `azd up` has deployed the App Service managed identity.
- [ ] Review `/config` and app settings against [`docs/config-schema.md`](config-schema.md).
- [ ] Finalize `config/grounding/company-direction.md`.
- [ ] Confirm safe questions in `config/agent.json`.
- [ ] Run the web app locally or confirm the deployed URL is available:
  ```bash
  dotnet run --project web/src/VoiceLive.Web
  ```
- [ ] Open `/?view=operator`, sign in, grant microphone permission, and ask a safe question with hold-to-talk.

## Event-day setup

- [ ] Confirm local `az login` is still valid, or confirm the deployed App Service is healthy.
- [ ] Start the local web app or open the deployed URL:
  ```bash
  dotnet run --project web/src/VoiceLive.Web
  ```
- [ ] Check health: `curl -s http://localhost:5280/api/health`.
- [ ] Open the default landing view: `http://localhost:5280/` or `<deployed-url>/`. Use the ⚙ gear to reach the operator view.
- [ ] Open operator view: `http://localhost:5280/?view=operator` or `<deployed-url>/?view=operator`.
- [ ] Open display view if needed: `http://localhost:5280/?view=display` or `<deployed-url>/?view=display`.
- [ ] Sign in with the configured operator credentials.
- [ ] Grant microphone permission in the operator browser.
- [ ] Click a safe question or use hold-to-talk once to satisfy browser autoplay/user-gesture requirements.
- [ ] Confirm avatar video and audio arrive.
- [ ] Confirm one safe question completes end-to-end with streaming transcript and final response.

## During-show controls

- [ ] Use **Hold to talk** for live operator input.
- [ ] Use safe-question buttons to steer back to approved topics.
- [ ] Use repeat to replay the last completed answer when needed.
- [ ] Use barge-in/interrupt controls if the avatar needs to stop speaking.
- [ ] If an avatar/session error appears, the session has closed; reload/restart the tab and repeat the setup interaction.

## Known limitations to brief stakeholders

- [ ] Each browser tab opens its own `/ws/session`; shared operator+display rooms are future work.
- [ ] Agent mode is opt-in and requires a Voice Live agent created in the Azure AI Foundry portal.
- [ ] Browsers require a user gesture before video/audio autoplay; the operator should sign in, grant mic permission, then press a control before showtime.
