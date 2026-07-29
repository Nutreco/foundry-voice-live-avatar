# Immersive Landing Screen + Agent-Mode Tool Gating — Design

Date: 2026-07-24
Status: Approved (brainstorm)
Scope: `web/frontend` (front-end only). No `.NET` / backend changes.

## 1. Context

The web app (`web/src/VoiceLive.Web`) serves a single-page front end bundled from
`web/frontend/src` (esbuild → `wwwroot/app.js`). Today `boot()` in `main.ts` chooses
between two views via the `?view=` query parameter:

- `operator` (default): a dense technical panel — config readout, six status lines,
  hold/stop/repeat controls, safe-question buttons, transcript, and a **Tool activity**
  panel. This is effectively a troubleshooting console.
- `display` (`?view=display`): a passive fullscreen avatar with a status overlay and
  **no** microphone or controls.

The server sends a `ready` frame whose `config` already carries `mode` (`"model"` or
`"agent"`), `activeMode` (turn-taking: `gated` / `open-mic` / `hybrid`), `agentName`,
`safeQuestions`, and avatar metadata. Session mode is resolved server-side by
`SessionModeResolver` (`web/src/VoiceLive.Web/Config`).

Two problems:

1. The default screen a visitor lands on is the technical operator console, not an
   inviting avatar experience.
2. The **Tool activity** panel is always shown, even in `model` mode where no tool
   calls ever occur.

## 2. Goals

1. Add a new **immersive landing view** and make it the **default** screen: a clean,
   fullscreen, *interactive* avatar experience (visitors can talk to the avatar).
2. Keep the operator console as an opt-in troubleshooting screen, reachable from the
   landing screen via a subtle gear icon (`?view=operator`).
3. Show the operator **Tool activity** panel **only** in `agent` mode.

## 3. Non-Goals

- No backend / `.NET` changes. The `ready` frame already includes everything needed.
- No change to the existing passive `display` view.
- No new turn-taking behavior. The landing view reuses the existing mic pipeline and
  gated / open-mic / hybrid logic.
- No always-on captions and no Stop / Repeat / safe-question controls on the landing
  screen (explicitly kept minimal — see §5).

## 4. Routing

`boot()` maps `?view=` to a view:

| `?view=`            | View                     |
| ------------------- | ------------------------ |
| *(absent)* / unknown | **immersive landing** (new default) |
| `operator`          | operator console         |
| `landing`           | immersive landing (explicit) |
| `display`           | passive display (unchanged) |

The default flips from `operator` to the immersive landing. The landing view's gear
navigates to `?view=operator`; the operator view needs no link back (browser back, or
edit the URL).

## 5. Immersive landing view (`renderLandingView`)

Fullscreen, avatar-first, minimal chrome. Elements:

- **Avatar** — `<video id="avatar" autoplay playsinline>` sized to fill the viewport
  (`width:100vw; height:100vh; object-fit:cover`) on a black background. Reuses the
  same track-attach flow as the other views (the client sets `avatar.srcObject`).
- **Status pill (top-center)** — a small translucent pill for transient state:
  `Connecting…`, `Connected`, and non-fatal notices. Hidden when steady/ready.
- **Gear (top-right)** — a subtle circular button linking to `?view=operator`
  (an anchor styled as a button; label/`aria-label` "Troubleshoot").
- **Talk control (bottom-center)** — primary affordance, mode-aware:
  - `gated`: **Hold to talk** — press-and-hold using the same pointer-event flow as the
    operator hold button (pointerdown → `start-turn` + stream mic; pointerup/leave/cancel
    → `end-turn`).
  - `open-mic` / `hybrid`: a non-hold **Listening** indicator plus a **mute** toggle
    (mic streams continuously; mute stops sending frames). No press-and-hold.
- **Transcript toggle (bottom-right)** — a 💬 button that opens/closes a **right-side
  slide-in transcript panel** (header + close ×, scrollable list of `You` / agent lines).
  Reuses the same incremental live/final transcript rendering as the operator view. On
  narrow screens (`max-width` breakpoint) the panel becomes a full-width bottom sheet via
  CSS. Collapsed by default.
- **Fatal error overlay** — a clear, centered message surface (graceful failure): names
  what failed. Mirrors the operator `setError` semantics.
- **Non-fatal notice** — avatar-unavailable and similar non-fatal events surface here
  ("Avatar video unavailable — voice continues"), not as a fatal error.

The landing view **is interactive**: the client runs the full microphone pipeline for it
(getUserMedia + `pcm-worklet` + gated/open-mic streaming), identical to the operator path.

## 6. Front-end architecture / refactor (`main.ts`, `views.ts`)

Today `ThinVoiceLiveClient` branches on a single `operator: OperatorView | undefined`
field and gates mic setup + control wiring behind `if (this.operator)`. The landing view
also needs mic + talk controls + transcript, so we generalize "operator" into a shared
**interactive view** contract instead of duplicating client logic.

### `InteractiveView` contract (in `views.ts`)

Common members implemented by **both** `OperatorView` and the new `LandingView`:

```
root: HTMLElement
avatar: HTMLVideoElement
holdButton: HTMLButtonElement           // talk control (hold in gated; label swaps per mode)
setConfig(config: ReadyConfig): void
setStatus(name: StatusName, value: string): void
setError(message: string): void
clearError(): void
setReady(ready: boolean): void
setHoldActive(active: boolean): void
addTranscript(role, text, final): void
noteNonFatal(message: string): void     // NEW — non-fatal notices (avatar-unavailable, etc.)
```

Operator-only extras stay optional on the contract (present only on `OperatorView`):
`stopButton`, `repeatButton`, `safeQuestionButtons`, `noteTool`.

### `ThinVoiceLiveClient` changes

- Replace the `operator` field with an `interactive?: InteractiveView` field, set for
  **both** operator and landing views (the passive `DisplayView` remains the non-interactive
  branch). Mic setup and hold-to-talk wiring key off `interactive`, not `operator`.
- Wire `stopButton` / `repeatButton` / `safeQuestionButtons` **only when present**
  (operator). The landing view omits them, so those handlers are simply skipped.
- **Status mapping**: the operator shows all six named statuses verbatim. The landing view
  maps a subset to its pill — `connection`, `webrtc`, `avatar` → concise pill text — and
  ignores the finer-grained ones (`speech`, `turn`, `microphone`) to stay clean.
- `handleAvatarError` calls `interactive.noteNonFatal(message)` (was `operator.noteTool`).
  For the `DisplayView` branch it still uses `setStatus`/notice as today.

### Talk-control mode handling

`wireInteractiveControls(config)` (generalized from `wireOperatorControls`):
- `gated` → hold button visible; press-and-hold semantics.
- `open-mic` / `hybrid` → hold button reflows to a "Listening" state with a mute toggle;
  no press-and-hold (mic already streams continuously after `prepareMicrophone`).

The operator view keeps its current richer control wiring; only the shared talk/hold and
transcript paths move into the shared contract.

## 7. Tool-panel gating (operator, `views.ts`)

- In `renderOperatorView`, the **Tool activity** panel starts **hidden**
  (`toolsPanel.hidden = true`).
- In `OperatorView.setConfig`, reveal it **only** when `config.mode === "agent"`
  (`toolsPanel.hidden = config.mode !== "agent"`).
- Because avatar-unavailable no longer routes through `noteTool` (it uses `noteNonFatal`),
  hiding the tools panel in `model` mode never hides a non-fatal avatar notice. `noteTool`
  now carries only genuine tool-call activity, which only occurs in `agent` mode.

## 8. Styling (`wwwroot/index.html`)

The inline `<style>` block gains a `landing-view` treatment analogous to the existing
`display-view` rules:

- `body.landing-view { background:#000 }`, avatar fills the viewport with `object-fit:cover`.
- Floating controls (status pill, gear, talk button, transcript toggle) positioned with
  `position:fixed`, translucent backgrounds, subtle shadows.
- Right-side transcript panel: fixed right, slide/opacity transition, dark translucent
  backdrop; a `max-width` media query switches it to a full-width bottom sheet.
- Non-fatal notice + fatal error surfaces styled for a dark fullscreen context.

Existing `operator-shell` and `display-view` styles are unchanged except for the tools
panel now honoring `hidden`.

## 9. Error handling

- **Fatal** (e.g. WS failure, session error): `setError` overlay names the failure; the
  server closes the socket as today. Clear signal, graceful presentation.
- **Non-fatal** (avatar capacity / `avatar-error`): the bridge already keeps the voice
  session alive and emits `avatar-error`; the client closes the avatar `RTCPeerConnection`
  and shows a `noteNonFatal` notice. Voice continues. (Bridge behavior unchanged.)

## 10. Testing / validation

Front-end only, so:

- `cd web/frontend && npm run typecheck` — strict `tsc --noEmit`. Must pass (the new
  `InteractiveView` contract and view implementations are the main type surface).
- `cd web/frontend && npm run build` — esbuild bundle → `wwwroot/app.js`.
- `dotnet test web/VoiceLive.Web.sln` — regression guard; backend is untouched so all
  existing tests must still pass. (Add `-p:SkipFrontendBuild=true` to skip the MSBuild
  frontend build when iterating.)

Manual smoke:
- Default URL → immersive landing; avatar fills screen; Hold-to-talk works (gated).
- Gear → operator console.
- `model` mode → operator hides Tool activity panel; `agent` mode → panel visible.
- Force an avatar capacity error → non-fatal notice on both landing and operator; voice
  continues.

## 11. File touch list

- `web/frontend/src/views.ts` — add `InteractiveView`, `LandingView` +
  `renderLandingView`; add `noteNonFatal`; gate the operator tools panel.
- `web/frontend/src/main.ts` — routing default flip; generalize `operator` →
  `interactive`; mode-aware talk control; `noteNonFatal` routing.
- `web/src/VoiceLive.Web/wwwroot/index.html` — `landing-view` styles + tools-panel
  `hidden` support.
- `web/src/VoiceLive.Web/wwwroot/app.js` — regenerated by `npm run build` (not hand-edited).
```
