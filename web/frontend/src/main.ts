import { renderDisplayView, renderLandingView, renderOperatorView, type DisplayView, type InteractiveView, type OperatorView, type ReadyConfig } from "./views";

type IceServerFrame = { urls: string[]; username?: string; credential?: string };
type ReadyFrame = { t: "ready"; config: ReadyConfig; iceServers: IceServerFrame[] };
type AvatarAnswerFrame = { t: "avatar-answer"; sdp: string };
type TranscriptFrame = { t: "user-transcript" | "agent-transcript"; text: string; final: boolean };
type ErrorFrame = { t: "error"; message: string };
type ToolFrame = { t: "tool"; phase: string; name?: string | null; callId?: string | null };
type AvatarErrorFrame = { t: "avatar-error"; code?: string; message: string };
type ServerFrame =
  | ReadyFrame
  | AvatarAnswerFrame
  | TranscriptFrame
  | ErrorFrame
  | ToolFrame
  | AvatarErrorFrame
  | { t: "speech-started" | "speech-stopped" | "avatar-speaking" | "avatar-idle" | "response-done" };

type ControlFrame =
  | { t: "avatar-offer"; sdp: string }
  | { t: "start-turn" }
  | { t: "end-turn" }
  | { t: "barge-in" }
  | { t: "say"; text: string }
  | { t: "ping" };

const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/session`;

function isInteractiveView(view: InteractiveView | DisplayView): view is InteractiveView {
  return "holdButton" in view;
}

function parseServerFrame(data: string): ServerFrame {
  const frame = JSON.parse(data) as Partial<ServerFrame>;
  if (typeof frame.t !== "string") throw new Error("server frame missing t");
  return frame as ServerFrame;
}

function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(done, 2_500);
    function done() {
      window.clearTimeout(timeout);
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    }
    function onChange() {
      if (pc.iceGatheringState === "complete") done();
    }
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

class ThinVoiceLiveClient {
  private readonly view: InteractiveView | DisplayView;
  private readonly interactive: InteractiveView | undefined;
  private socket: WebSocket | undefined;
  private pc: RTCPeerConnection | undefined;
  private audioContext: AudioContext | undefined;
  private audioNodes: AudioNode[] = [];
  private micStream: MediaStream | undefined;
  private streamingMic = false;
  private gatedHoldIntent: { token: number; audioContext: AudioContext } | undefined;
  private readyConfig: ReadyConfig | undefined;
  private pingId = 0;
  private sessionToken = 0;
  private disconnected = true;
  private disconnectPromise: Promise<void> | undefined;

  constructor(view: InteractiveView | DisplayView) {
    this.view = view;
    this.interactive = isInteractiveView(view) ? view : undefined;
    this.view.setReconnectHandler(() => this.start());
  }

  start() {
    if (this.socket || this.disconnectPromise) return;
    this.disconnected = false;
    const token = ++this.sessionToken;
    this.view.setDisconnected(false);
    this.interactive?.setReady(false);
    this.view.clearError();
    this.setStatus("connection", "connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl);
    } catch (error) {
      void this.disconnect(`WebSocket setup failed: ${error instanceof Error ? error.message : String(error)}`, token);
      return;
    }
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      if (this.isCurrentSession(token, socket)) this.setStatus("connection", "connected; waiting for ready");
    });
    socket.addEventListener("message", (event) => {
      if (this.isCurrentSession(token, socket)) void this.onMessage(event, token);
    });
    socket.addEventListener("error", () => {
      if (!this.isCurrentSession(token, socket)) return;
      void this.disconnect("WebSocket failed. Check that the ASP.NET app is running and /ws/session is available.", token);
    });
    socket.addEventListener("close", (event) => {
      if (!this.isCurrentSession(token, socket)) return;
      const message = event.wasClean
        ? undefined
        : "WebSocket closed unexpectedly; the server-side Voice Live session ended.";
      void this.disconnect(message, token);
    });
    this.pingId = window.setInterval(() => {
      if (this.isCurrentSession(token, socket)) this.send({ t: "ping" });
    }, 25_000);
  }

  private isCurrentSession(token: number, socket?: WebSocket) {
    return token === this.sessionToken && (!socket || this.socket === socket);
  }

  private async onMessage(event: MessageEvent, token: number) {
    if (!this.isCurrentSession(token)) return;
    if (typeof event.data !== "string") return;
    let frame: ServerFrame;
    try {
      frame = parseServerFrame(event.data);
    } catch (error) {
      this.fail(`Could not parse server message: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    switch (frame.t) {
      case "ready":
        await this.onReady(frame, token);
        break;
      case "avatar-answer":
        await this.onAvatarAnswer(frame.sdp, token);
        break;
      case "user-transcript":
      case "agent-transcript":
        this.interactive?.addTranscript(frame.t === "user-transcript" ? "user" : "agent", frame.text, frame.final);
        break;
      case "speech-started":
        this.setStatus("speech", "started");
        break;
      case "speech-stopped":
        this.setStatus("speech", "stopped");
        break;
      case "avatar-speaking":
        this.setStatus("avatar", "speaking");
        break;
      case "avatar-idle":
        this.setStatus("avatar", "idle");
        break;
      case "response-done":
        this.setStatus("turn", "response done");
        break;
      case "tool": {
        const label = frame.name ? `${frame.phase}: ${frame.name}` : frame.phase;
        const idSuffix = frame.callId ? ` (${frame.callId})` : "";
        this.interactive?.noteTool?.(`tool ${label}${idSuffix}`);
        break;
      }
      case "avatar-error":
        this.handleAvatarError(frame.message);
        break;
      case "error":
        this.fail(`Server error: ${frame.message}`);
        break;
    }
  }

  private async onReady(frame: ReadyFrame, token: number) {
    if (!this.isCurrentSession(token)) return;
    this.readyConfig = frame.config;
    if (this.interactive) {
      this.interactive.clearError();
      this.interactive.setConfig(frame.config);
      this.interactive.setReady(true);
      this.wireInteractiveControls(frame.config);
    } else {
      (this.view as DisplayView).setStatus(`Ready: ${frame.config.agentName}`);
    }
    this.setStatus("connection", "ready");

    await this.negotiateAvatar(frame.iceServers, token);
    if (!this.isCurrentSession(token)) return;
    if (this.interactive) await this.prepareMicrophone(frame.config.activeMode, token);
  }

  private wireInteractiveControls(config: ReadyConfig) {
    const view = this.interactive;
    if (!view) return;
    const gated = config.activeMode === "gated";
    this.gatedHoldIntent = undefined;

    view.holdButton.onclick = null;
    view.holdButton.onpointerdown = null;
    view.holdButton.onpointerup = null;
    view.holdButton.onpointerleave = null;
    view.holdButton.onpointercancel = null;

    if (gated) {
      view.holdButton.hidden = false;
      view.holdButton.onpointerdown = (event) => {
        event.preventDefault();
        this.startGatedTurn();
      };
      const endGated = () => this.endGatedTurn();
      view.holdButton.onpointerup = endGated;
      view.holdButton.onpointerleave = endGated;
      view.holdButton.onpointercancel = endGated;
    } else if (view.supportsMuteToggle) {
      view.holdButton.hidden = false;
      view.holdButton.onclick = () => this.toggleMute();
    } else {
      view.holdButton.hidden = true;
    }

    if (view.stopButton) {
      view.stopButton.onclick = () => {
        this.send({ t: "barge-in" });
        this.setStatus("turn", "barge-in sent");
      };
    }
    if (view.repeatButton) {
      view.repeatButton.onclick = () => this.sendSay("Please repeat your previous answer.");
    }
    if (view.safeQuestionButtons) {
      for (const safeButton of view.safeQuestionButtons) {
        safeButton.onclick = () => this.sendSay(safeButton.textContent ?? "");
      }
    }
  }

  private async negotiateAvatar(iceServers: IceServerFrame[], token: number) {
    this.setStatus("webrtc", "creating peer connection");
    try {
      const pc = new RTCPeerConnection({
        iceServers: iceServers.map((server) => ({
          urls: server.urls,
          username: server.username,
          credential: server.credential,
        })),
      });
      if (!this.isCurrentSession(token)) {
        pc.close();
        return;
      }
      this.pc = pc;
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.ontrack = (event) => {
        if (!this.isCurrentSession(token) || this.pc !== pc) return;
        const [stream] = event.streams;
        if (!stream) return;
        // Bundled avatar video+audio arrive as separate track events on the same stream; attach once.
        if (this.view.avatar.srcObject === stream) return;
        this.view.avatar.srcObject = stream;
        this.view.avatar.play().catch((error: unknown) => {
          // AbortError means a newer load interrupted play(); media can still be flowing.
          if (error instanceof DOMException && error.name === "AbortError") return;
          void this.disconnect(
            `Browser blocked avatar playback: ${error instanceof Error ? error.message : String(error)}. Interact with the page and retry if needed.`,
            token,
          );
        });
      };
      pc.onconnectionstatechange = () => {
        if (this.isCurrentSession(token) && this.pc === pc) this.setStatus("webrtc", pc.connectionState);
      };

      const offer = await pc.createOffer();
      if (!this.isCurrentSession(token) || this.pc !== pc) return;
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);
      if (!this.isCurrentSession(token) || this.pc !== pc) return;
      const sdp = pc.localDescription?.sdp;
      if (!sdp) throw new Error("browser did not create a local SDP offer");
      this.send({ t: "avatar-offer", sdp });
      this.setStatus("webrtc", "offer sent; waiting for answer");
    } catch (error) {
      await this.disconnect(`Avatar WebRTC negotiation failed: ${error instanceof Error ? error.message : String(error)}`, token);
    }
  }

  private async onAvatarAnswer(sdp: string, token: number) {
    if (!this.isCurrentSession(token)) return;
    if (!this.pc) {
      await this.disconnect("Received avatar SDP answer before the browser peer connection existed.", token);
      return;
    }
    const pc = this.pc;
    try {
      await pc.setRemoteDescription({ type: "answer", sdp });
      if (!this.isCurrentSession(token) || this.pc !== pc) return;
      this.setStatus("webrtc", "answer applied");
    } catch (error) {
      await this.disconnect(`Browser rejected avatar SDP answer: ${error instanceof Error ? error.message : String(error)}`, token);
    }
  }

  private async prepareMicrophone(activeMode: string, token: number) {
    if (!this.interactive) return;
    try {
      this.setStatus("microphone", "requesting permission");
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      if (!this.isCurrentSession(token)) {
        micStream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.micStream = micStream;
      const audioContext = new AudioContext({ sampleRate: 24_000 });
      this.audioContext = audioContext;
      await audioContext.audioWorklet.addModule("/pcm-worklet.js");
      if (!this.isCurrentSession(token) || this.audioContext !== audioContext) return;

      const source = audioContext.createMediaStreamSource(micStream);
      const worklet = new AudioWorkletNode(audioContext, "pcm16-worklet");
      const silentOutput = audioContext.createGain();
      silentOutput.gain.value = 0;
      worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (this.isCurrentSession(token) && this.streamingMic && this.socket?.readyState === WebSocket.OPEN) this.socket.send(event.data);
      };
      source.connect(worklet).connect(silentOutput).connect(audioContext.destination);
      this.audioNodes = [source, worklet, silentOutput];
      this.setStatus("microphone", `ready (${Math.round(audioContext.sampleRate)} Hz context)`);

      if (activeMode === "open-mic" || activeMode === "hybrid") {
        await audioContext.resume();
        if (!this.isCurrentSession(token) || this.audioContext !== audioContext) return;
        this.streamingMic = true;
        this.interactive?.setMuted?.(false);
        this.setStatus("turn", `${activeMode}: streaming continuously`);
      } else {
        this.setStatus("turn", "gated: hold to talk");
      }
    } catch (error) {
      await this.disconnect(`Microphone setup failed: ${error instanceof Error ? error.message : String(error)}`, token);
    }
  }

  private async startGatedTurn() {
    if (!this.interactive) return;
    const token = this.sessionToken;
    const audioContext = this.audioContext;
    if (!audioContext) {
      this.fail("Microphone is not ready; cannot start a gated turn.");
      return;
    }
    const holdIntent = { token, audioContext };
    this.gatedHoldIntent = holdIntent;
    try {
      await audioContext.resume();
    } catch (error) {
      if (
        !this.isCurrentSession(token) ||
        this.audioContext !== audioContext ||
        this.gatedHoldIntent !== holdIntent
      ) return;
      this.gatedHoldIntent = undefined;
      this.fail(`Could not resume microphone capture: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (
      !this.isCurrentSession(token) ||
      this.audioContext !== audioContext ||
      this.gatedHoldIntent !== holdIntent
    ) return;
    this.send({ t: "start-turn" });
    this.streamingMic = true;
    this.interactive.setHoldActive(true);
    this.setStatus("turn", "recording gated turn");
  }

  private endGatedTurn() {
    this.gatedHoldIntent = undefined;
    if (!this.streamingMic) return;
    this.stopMicStreaming();
    this.interactive?.setHoldActive(false);
    this.send({ t: "end-turn" });
    this.setStatus("turn", "gated turn sent");
  }

  private stopMicStreaming() {
    this.streamingMic = false;
  }

  private toggleMute() {
    this.streamingMic = !this.streamingMic;
    this.interactive?.setMuted?.(!this.streamingMic);
    this.setStatus("microphone", this.streamingMic ? "live" : "muted");
  }

  private sendSay(text: string) {
    if (text.trim().length === 0) return;
    this.send({ t: "say", text });
    this.setStatus("turn", "say sent");
  }

  private send(frame: ControlFrame) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(frame));
  }

  private setStatus(name: "connection" | "speech" | "avatar" | "turn" | "webrtc" | "microphone", value: string) {
    if (this.interactive) this.interactive.setStatus(name, value);
    else if (name === "connection" || name === "webrtc" || name === "avatar") (this.view as DisplayView).setStatus(`${name}: ${value}`);
  }

  private handleAvatarError(message: string) {
    // Avatar rendering is unavailable (e.g. capacity/quota); the voice session continues without video.
    this.pc?.close();
    this.pc = undefined;
    this.setStatus("avatar", "unavailable");
    this.setStatus("webrtc", "avatar disabled (capacity)");
    if (this.interactive) this.interactive.noteNonFatal(`Avatar unavailable: ${message}`);
    else (this.view as DisplayView).setStatus(`Avatar unavailable: ${message}`);
  }

  private fail(message: string) {
    if (this.interactive) this.interactive.setError(message);
    else (this.view as DisplayView).setError(message);
  }

  private async disconnect(message?: string, token?: number) {
    if (token !== undefined && token !== this.sessionToken) return;
    if (this.disconnectPromise) {
      await this.disconnectPromise;
      return;
    }
    if (this.disconnected) return;

    this.disconnected = true;
    ++this.sessionToken;
    this.gatedHoldIntent = undefined;
    this.interactive?.setReady(false);
    this.interactive?.setHoldActive(false);

    const cleanup = (async () => {
      if (this.pingId) {
        window.clearInterval(this.pingId);
        this.pingId = 0;
      }

      this.stopMicStreaming();
      const micStream = this.micStream;
      this.micStream = undefined;
      micStream?.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Continue tearing down any remaining browser resources.
        }
      });

      const audioNodes = this.audioNodes;
      this.audioNodes = [];
      for (const node of audioNodes) {
        try {
          node.disconnect();
        } catch {
          // Continue tearing down any remaining browser resources.
        }
      }

      const audioContext = this.audioContext;
      this.audioContext = undefined;

      const pc = this.pc;
      this.pc = undefined;
      try {
        pc?.close();
      } catch {
        // Continue tearing down any remaining browser resources.
      }
      this.view.avatar.srcObject = null;

      const socket = this.socket;
      this.socket = undefined;
      if (socket && socket.readyState < WebSocket.CLOSING) {
        try {
          socket.close();
        } catch {
          // Continue tearing down any remaining browser resources.
        }
      }

      this.readyConfig = undefined;
      if (audioContext && audioContext.state !== "closed") {
        try {
          await audioContext.close();
        } catch {
          // A failed close must not prevent the rest of the session teardown.
        }
      }

      this.setStatus("connection", "disconnected");
      if (message) this.fail(message);
      this.view.setDisconnected(true);
    })();

    this.disconnectPromise = cleanup;
    try {
      await cleanup;
    } finally {
      if (this.disconnectPromise === cleanup) this.disconnectPromise = undefined;
    }
  }

  dispose() {
    void this.disconnect();
  }
}

function boot() {
  const viewName = new URLSearchParams(location.search).get("view") ?? "landing";
  const root = document.getElementById("app");
  if (!root) throw new Error("Missing #app root element.");

  const view: InteractiveView | DisplayView =
    viewName === "operator" ? renderOperatorView(root)
    : viewName === "display" ? renderDisplayView(root)
    : renderLandingView(root);
  const client = new ThinVoiceLiveClient(view);
  window.addEventListener("beforeunload", () => client.dispose());
  client.start();
}

try {
  boot();
} catch (error) {
  document.body.innerHTML = `<pre style="color:red">Startup failed: ${error instanceof Error ? error.message : String(error)}</pre>`;
}
