export type ReadyConfig = {
  mode?: string;
  activeMode: string;
  agentName: string;
  safeQuestions: string[];
  avatarCharacter?: string;
  avatarStyle?: string;
};

export type StatusName = "connection" | "speech" | "avatar" | "turn" | "webrtc" | "microphone";

export type InteractiveView = {
  root: HTMLElement;
  avatar: HTMLVideoElement;
  holdButton: HTMLButtonElement;
  setConfig(config: ReadyConfig): void;
  setStatus(name: StatusName, value: string): void;
  setError(message: string): void;
  clearError(): void;
  setReady(ready: boolean): void;
  setReconnectHandler(handler: () => void): void;
  setDisconnected(disconnected: boolean): void;
  setHoldActive(active: boolean): void;
  addTranscript(role: "user" | "agent", text: string, final: boolean): void;
  noteNonFatal(message: string): void;
  supportsMuteToggle?: boolean;
  setMuted?(muted: boolean): void;
  stopButton?: HTMLButtonElement;
  repeatButton?: HTMLButtonElement;
  safeQuestionButtons?: HTMLButtonElement[];
  noteTool?(text: string): void;
};

export type OperatorView = InteractiveView & {
  stopButton: HTMLButtonElement;
  repeatButton: HTMLButtonElement;
  safeQuestionButtons: HTMLButtonElement[];
  noteTool(text: string): void;
};

export type LandingView = InteractiveView & {
  supportsMuteToggle: true;
  setMuted(muted: boolean): void;
};

export type DisplayView = {
  root: HTMLElement;
  avatar: HTMLVideoElement;
  setStatus(message: string): void;
  setError(message: string): void;
  clearError(): void;
  setReconnectHandler(handler: () => void): void;
  setDisconnected(disconnected: boolean): void;
};

function button(label: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.disabled = true;
  return element;
}

function statusLine(label: string): HTMLParagraphElement {
  const line = document.createElement("p");
  line.className = "status-line";
  line.dataset.label = label;
  line.textContent = `${label}: pending`;
  return line;
}

function setText(element: HTMLElement, value: string) {
  element.textContent = value;
}

function createTranscriptAppender(list: HTMLElement) {
  const liveText: Record<"user" | "agent", string> = { user: "", agent: "" };
  return function addTranscript(role: "user" | "agent", text: string, final: boolean) {
    const existing = list.querySelector<HTMLElement>(`.transcript-line.live.${role}`);
    const line = existing ?? document.createElement("p");
    const transcriptText = final ? text : liveText[role] + text;
    liveText[role] = final ? "" : transcriptText;
    line.className = `transcript-line ${role} ${final ? "final" : "live"}`;
    line.textContent = `${role === "user" ? "You" : "Agent"}${final ? "" : " (live)"}: ${transcriptText}`;
    if (!existing) list.append(line);
    if (final) line.classList.remove("live");
    line.scrollIntoView({ block: "nearest" });
  };
}

export function renderOperatorView(root: HTMLElement): OperatorView {
  document.body.classList.remove("display-view", "landing-view");
  root.replaceChildren();

  const shell = document.createElement("main");
  shell.className = "operator-shell";

  const heading = document.createElement("h1");
  heading.textContent = "Voice Live Operator";

  const error = document.createElement("div");
  error.className = "error-banner";
  error.hidden = true;
  error.setAttribute("role", "alert");

  const reconnectButton = document.createElement("button");
  reconnectButton.type = "button";
  reconnectButton.className = "reconnect-button";
  reconnectButton.textContent = "Reconnect";
  reconnectButton.hidden = true;

  const avatarPanel = document.createElement("section");
  avatarPanel.className = "avatar-panel";
  const avatar = document.createElement("video");
  avatar.id = "avatar";
  avatar.autoplay = true;
  avatar.playsInline = true;
  avatarPanel.append(avatar);

  const configPanel = document.createElement("section");
  configPanel.className = "config-panel";
  const agentLine = document.createElement("p");
  agentLine.textContent = "Agent: waiting for server";
  const sessionModeLine = document.createElement("p");
  sessionModeLine.textContent = "Session mode: waiting for server";
  const modeLine = document.createElement("p");
  modeLine.textContent = "Turn-taking: waiting for server";
  const avatarLine = document.createElement("p");
  avatarLine.textContent = "Avatar: waiting for server";
  configPanel.append(agentLine, sessionModeLine, modeLine, avatarLine);

  const statuses = new Map<StatusName, HTMLParagraphElement>();
  const statusPanel = document.createElement("section");
  statusPanel.className = "status-panel";
  for (const name of ["connection", "webrtc", "microphone", "turn", "speech", "avatar"] as StatusName[]) {
    const line = statusLine(name);
    statuses.set(name, line);
    statusPanel.append(line);
  }

  const controls = document.createElement("section");
  controls.className = "controls";
  const holdButton = button("Hold to talk");
  const stopButton = button("Stop speaking");
  const repeatButton = button("Repeat last answer");
  const safeQuestionPanel = document.createElement("div");
  safeQuestionPanel.className = "safe-questions";
  controls.append(holdButton, stopButton, repeatButton, safeQuestionPanel);

  const transcriptPanel = document.createElement("section");
  transcriptPanel.className = "transcripts";
  const transcriptHeading = document.createElement("h2");
  transcriptHeading.textContent = "Transcript";
  const transcriptList = document.createElement("div");
  transcriptList.className = "transcript-list";
  transcriptPanel.append(transcriptHeading, transcriptList);
  const addTranscript = createTranscriptAppender(transcriptList);

  const safeQuestionButtons: HTMLButtonElement[] = [];

  const toolsPanel = document.createElement("section");
  toolsPanel.className = "tools-panel";
  const toolsHeading = document.createElement("h2");
  toolsHeading.textContent = "Tool activity";
  const toolsList = document.createElement("div");
  toolsList.className = "tools-list";
  const toolsEmpty = document.createElement("p");
  toolsEmpty.className = "tools-empty";
  toolsEmpty.textContent = "No tool calls yet.";
  toolsPanel.append(toolsHeading, toolsList, toolsEmpty);
  toolsPanel.hidden = true;

  const nonFatal = document.createElement("div");
  nonFatal.className = "nonfatal-notice";
  nonFatal.hidden = true;
  nonFatal.setAttribute("role", "status");

  shell.append(heading, error, reconnectButton, nonFatal, avatarPanel, configPanel, statusPanel, controls, transcriptPanel, toolsPanel);
  root.append(shell);

  return {
    root,
    avatar,
    holdButton,
    stopButton,
    repeatButton,
    safeQuestionButtons,
    setConfig(config) {
      setText(agentLine, `Agent: ${config.agentName}`);
      setText(sessionModeLine, `Session mode: ${config.mode ?? "model"}`);
      setText(modeLine, `Turn-taking: ${config.activeMode}`);
      setText(avatarLine, `Avatar: ${config.avatarCharacter ?? "configured"}${config.avatarStyle ? ` (${config.avatarStyle})` : ""}`);
      toolsPanel.hidden = config.mode !== "agent";
      safeQuestionPanel.replaceChildren();
      safeQuestionButtons.splice(0);
      for (const question of config.safeQuestions) {
        const safeButton = button(question);
        safeQuestionButtons.push(safeButton);
        safeQuestionPanel.append(safeButton);
      }
    },
    setStatus(name, value) {
      const line = statuses.get(name);
      if (line) line.textContent = `${name}: ${value}`;
    },
    setError(message) {
      error.hidden = false;
      error.textContent = message;
    },
    clearError() {
      error.hidden = true;
      error.textContent = "";
    },
    setReady(ready) {
      holdButton.disabled = !ready;
      stopButton.disabled = !ready;
      repeatButton.disabled = !ready;
      for (const safeButton of safeQuestionButtons) safeButton.disabled = !ready;
    },
    setReconnectHandler(handler) {
      reconnectButton.onclick = handler;
    },
    setDisconnected(disconnected) {
      reconnectButton.hidden = !disconnected;
      holdButton.disabled = disconnected;
      stopButton.disabled = disconnected;
      repeatButton.disabled = disconnected;
      for (const safeButton of safeQuestionButtons) safeButton.disabled = disconnected;
    },
    setHoldActive(active) {
      holdButton.classList.toggle("active", active);
      holdButton.textContent = active ? "Release to end turn" : "Hold to talk";
    },
    addTranscript,
    noteTool(text) {
      toolsEmpty.hidden = true;
      const line = document.createElement("p");
      line.className = "tool-line";
      const stamp = new Date().toLocaleTimeString();
      line.textContent = `${stamp} — ${text}`;
      toolsList.append(line);
      while (toolsList.childElementCount > 8) toolsList.firstElementChild?.remove();
      line.scrollIntoView({ block: "nearest" });
    },
    noteNonFatal(message) {
      nonFatal.hidden = false;
      nonFatal.textContent = message;
    },
  };
}

export function renderLandingView(root: HTMLElement): LandingView {
  document.body.classList.add("landing-view");
  document.body.classList.remove("display-view");
  root.replaceChildren();

  const avatar = document.createElement("video");
  avatar.id = "avatar";
  avatar.className = "landing-avatar";
  avatar.autoplay = true;
  avatar.playsInline = true;

  const pill = document.createElement("div");
  pill.className = "landing-pill";
  pill.hidden = true;

  const actions = document.createElement("nav");
  actions.className = "landing-actions";
  actions.setAttribute("aria-label", "Landing controls");

  const gear = document.createElement("a");
  gear.className = "landing-action landing-config";
  gear.href = "?view=operator";
  gear.textContent = "⚙ Config";
  gear.setAttribute("aria-label", "Config");
  gear.title = "Config";

  const holdButton = document.createElement("button");
  holdButton.type = "button";
  holdButton.className = "landing-talk";
  holdButton.textContent = "🎤 Hold to talk";
  holdButton.disabled = true;
  holdButton.hidden = true;

  const transcriptToggle = document.createElement("button");
  transcriptToggle.type = "button";
  transcriptToggle.className = "landing-action landing-transcript-toggle";
  transcriptToggle.textContent = "💬 Transcript";
  transcriptToggle.setAttribute("aria-label", "Transcript");
  transcriptToggle.title = "Transcript";

  const panel = document.createElement("aside");
  panel.className = "landing-transcript";
  const panelHeader = document.createElement("header");
  const panelTitle = document.createElement("span");
  panelTitle.textContent = "Transcript";
  const panelClose = document.createElement("button");
  panelClose.type = "button";
  panelClose.className = "landing-transcript-close";
  panelClose.textContent = "×";
  panelClose.setAttribute("aria-label", "Close panel");
  panelHeader.append(panelTitle, panelClose);
  const transcriptList = document.createElement("div");
  transcriptList.className = "landing-transcript-list";
  panel.append(panelHeader, transcriptList);

  const togglePanel = () => panel.classList.toggle("open");
  transcriptToggle.onclick = togglePanel;
  panelClose.onclick = () => panel.classList.remove("open");

  const notice = document.createElement("div");
  notice.className = "landing-notice";
  notice.hidden = true;
  notice.setAttribute("role", "status");

  const errorOverlay = document.createElement("div");
  errorOverlay.className = "landing-error";
  errorOverlay.hidden = true;
  errorOverlay.setAttribute("role", "alert");

  const reconnectButton = document.createElement("button");
  reconnectButton.type = "button";
  reconnectButton.className = "reconnect-button landing-reconnect";
  reconnectButton.textContent = "Reconnect";
  reconnectButton.hidden = true;

  actions.append(gear, transcriptToggle);
  root.append(avatar, pill, actions, holdButton, panel, notice, errorOverlay, reconnectButton);

  const addTranscript = createTranscriptAppender(transcriptList);

  return {
    root,
    avatar,
    holdButton,
    supportsMuteToggle: true,
    setConfig() {
      // The landing screen is intentionally minimal; config drives only the talk control.
    },
    setStatus(name, value) {
      // The pill is only a transient connection indicator. Routine per-turn
      // avatar states (speaking/idle) are conveyed by the avatar itself and
      // must not resurface the pill after the connection is established.
      if (name !== "connection" && name !== "webrtc") return;
      if (name === "webrtc" && value === "connected") {
        pill.hidden = true;
        return;
      }
      pill.hidden = false;
      pill.textContent = value;
    },
    setError(message) {
      errorOverlay.hidden = false;
      errorOverlay.textContent = message;
    },
    clearError() {
      errorOverlay.hidden = true;
      errorOverlay.textContent = "";
    },
    setReady(ready) {
      holdButton.disabled = !ready;
    },
    setReconnectHandler(handler) {
      reconnectButton.onclick = handler;
    },
    setDisconnected(disconnected) {
      reconnectButton.hidden = !disconnected;
      holdButton.disabled = disconnected;
    },
    setHoldActive(active) {
      holdButton.classList.toggle("active", active);
      holdButton.textContent = active ? "🎤 Release to end turn" : "🎤 Hold to talk";
    },
    setMuted(muted) {
      holdButton.classList.toggle("muted", muted);
      holdButton.textContent = muted ? "🔇 Muted — tap to unmute" : "🎤 Listening — tap to mute";
    },
    addTranscript,
    noteNonFatal(message) {
      notice.hidden = false;
      notice.textContent = message;
    },
  };
}

export function renderDisplayView(root: HTMLElement): DisplayView {
  document.body.classList.add("display-view");
  document.body.classList.remove("landing-view");
  root.replaceChildren();

  const video = document.createElement("video");
  video.id = "avatar";
  video.autoplay = true;
  video.playsInline = true;

  const overlay = document.createElement("div");
  overlay.className = "display-status";
  overlay.setAttribute("role", "status");
  const message = document.createElement("span");
  message.textContent = "Connecting to avatar session…";

  const reconnectButton = document.createElement("button");
  reconnectButton.type = "button";
  reconnectButton.className = "reconnect-button display-reconnect";
  reconnectButton.textContent = "Reconnect";
  reconnectButton.hidden = true;

  overlay.append(message, reconnectButton);
  root.append(video, overlay);

  return {
    root,
    avatar: video,
    setStatus(value) {
      overlay.classList.remove("error");
      overlay.setAttribute("role", "status");
      message.textContent = value;
    },
    setError(value) {
      overlay.classList.add("error");
      overlay.setAttribute("role", "alert");
      message.textContent = value;
    },
    clearError() {
      overlay.classList.remove("error");
      overlay.setAttribute("role", "status");
      message.textContent = "";
    },
    setReconnectHandler(handler) {
      reconnectButton.onclick = handler;
    },
    setDisconnected(disconnected) {
      reconnectButton.hidden = !disconnected;
    },
  };
}
