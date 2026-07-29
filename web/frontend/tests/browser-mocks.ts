import type { Page } from "@playwright/test";

export type ReadyFrameOptions = {
  activeMode?: "gated" | "open-mic" | "hybrid";
  mode?: string;
  agentName?: string;
};

export type LifecycleState = {
  counters: {
    webSockets: number;
    getUserMedia: number;
    audioContexts: number;
    peerConnections: number;
    mediaPlay: number;
  };
  currentSocketIds: number[];
  sockets: Array<{ id: number; readyState: number; sent: Array<string | { binaryBytes: number }> }>;
  streams: Array<{ id: number; stoppedTracks: number }>;
  audioContexts: Array<{ id: number; sampleRate: number; state: string; closeCalls: number; resumeCalls: number }>;
  peerConnections: Array<{ id: number; closed: boolean; closeCalls: number; offerCalls: number }>;
  mediaPlayCalls: number;
  getUserMediaCalls: number;
  disconnectedAudioNodes: number;
};

type FailureName = "getUserMedia" | "audioWorklet" | "createOffer";

export async function installBrowserMocks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Deferred = { resolve: () => void; reject: (message: string) => void };
    type MockState = LifecycleState & {
      failures: Partial<Record<FailureName, string>>;
      pendingResumes: Record<number, Deferred>;
      pendingOffers: Record<number, Deferred>;
      nextResumePending: boolean;
      nextOfferPending: boolean;
    };

    const state: MockState = {
      counters: { webSockets: 0, getUserMedia: 0, audioContexts: 0, peerConnections: 0, mediaPlay: 0 },
      currentSocketIds: [],
      sockets: [],
      streams: [],
      audioContexts: [],
      peerConnections: [],
      mediaPlayCalls: 0,
      getUserMediaCalls: 0,
      disconnectedAudioNodes: 0,
      failures: {},
      pendingResumes: {},
      pendingOffers: {},
      nextResumePending: false,
      nextOfferPending: false,
    };

    class MockWebSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSING = 2;
      readonly CLOSED = 3;
      readonly id: number;
      readonly url: string;
      binaryType: BinaryType = "blob";
      readyState = MockWebSocket.CONNECTING;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        this.id = state.sockets.length + 1;
        state.counters.webSockets += 1;
        state.currentSocketIds.push(this.id);
        state.sockets.push({ id: this.id, readyState: this.readyState, sent: [] });
        queueMicrotask(() => {
          if (this.readyState !== MockWebSocket.CONNECTING) return;
          this.readyState = MockWebSocket.OPEN;
          this.record().readyState = this.readyState;
          this.dispatchEvent(new Event("open"));
        });
      }

      private record() {
        return state.sockets[this.id - 1];
      }

      send(data: string | ArrayBuffer | ArrayBufferView | Blob) {
        if (this.readyState !== MockWebSocket.OPEN) throw new DOMException("Socket is not open", "InvalidStateError");
        this.record().sent.push(
          typeof data === "string"
            ? data
            : { binaryBytes: data instanceof ArrayBuffer ? data.byteLength : "byteLength" in data ? data.byteLength : data.size },
        );
      }

      close() {
        if (this.readyState >= MockWebSocket.CLOSING) return;
        this.readyState = MockWebSocket.CLOSING;
        this.record().readyState = this.readyState;
        queueMicrotask(() => closeSocket(this.id, true));
      }
    }

    function socketById(id: number): MockWebSocket {
      const sockets = (window as unknown as { __mockSockets: MockWebSocket[] }).__mockSockets;
      const socket = sockets.find((candidate) => candidate.id === id);
      if (!socket) throw new Error(`Unknown socket ${id}`);
      return socket;
    }

    function closeSocket(id: number, clean: boolean) {
      const socket = socketById(id);
      if (socket.readyState === MockWebSocket.CLOSED) return;
      socket.readyState = MockWebSocket.CLOSED;
      state.sockets[id - 1].readyState = socket.readyState;
      state.currentSocketIds = state.currentSocketIds.filter((socketId) => socketId !== id);
      socket.dispatchEvent(new CloseEvent("close", { code: clean ? 1000 : 1006, wasClean: clean }));
    }

    const sockets: MockWebSocket[] = [];
    const WebSocketConstructor = class extends MockWebSocket {
      constructor(url: string | URL) {
        super(url);
        sockets.push(this);
      }
    };
    Object.assign(WebSocketConstructor, {
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
    });
    (window as unknown as { __mockSockets: MockWebSocket[] }).__mockSockets = sockets;
    Object.defineProperty(window, "WebSocket", { configurable: true, value: WebSocketConstructor });

    class MockTrack {
      stopped = false;
      stop() {
        if (this.stopped) return;
        this.stopped = true;
        state.streams[this.streamId - 1].stoppedTracks += 1;
      }
      constructor(private readonly streamId: number) {}
    }

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          state.counters.getUserMedia += 1;
          state.getUserMediaCalls += 1;
          const failure = state.failures.getUserMedia;
          delete state.failures.getUserMedia;
          if (failure) throw new Error(failure);
          const id = state.streams.length + 1;
          const track = new MockTrack(id);
          state.streams.push({ id, stoppedTracks: 0 });
          return { getTracks: () => [track] };
        },
      },
    });

    class MockAudioNode {
      connect() {
        return this;
      }
      disconnect() {
        state.disconnectedAudioNodes += 1;
      }
    }

    class MockAudioWorkletNode extends MockAudioNode {
      port = { onmessage: null as ((event: MessageEvent<ArrayBuffer>) => void) | null };
    }
    Object.defineProperty(window, "AudioWorkletNode", { configurable: true, value: MockAudioWorkletNode });

    class MockAudioContext {
      readonly id: number;
      readonly sampleRate: number;
      state: AudioContextState = "suspended";
      destination = new MockAudioNode();
      audioWorklet = {
        addModule: async () => {
          const failure = state.failures.audioWorklet;
          delete state.failures.audioWorklet;
          if (failure) throw new Error(failure);
        },
      };

      constructor(options?: AudioContextOptions) {
        this.id = state.audioContexts.length + 1;
        this.sampleRate = options?.sampleRate ?? 48_000;
        state.counters.audioContexts += 1;
        state.audioContexts.push({ id: this.id, sampleRate: this.sampleRate, state: this.state, closeCalls: 0, resumeCalls: 0 });
      }

      createMediaStreamSource() {
        return new MockAudioNode();
      }

      createGain() {
        return Object.assign(new MockAudioNode(), { gain: { value: 1 } });
      }

      async resume() {
        const record = state.audioContexts[this.id - 1];
        record.resumeCalls += 1;
        if (state.nextResumePending) {
          state.nextResumePending = false;
          await new Promise<void>((resolve, reject) => {
            state.pendingResumes[this.id] = {
              resolve: () => {
                delete state.pendingResumes[this.id];
                resolve();
              },
              reject: (message) => {
                delete state.pendingResumes[this.id];
                reject(new Error(message));
              },
            };
          });
        }
        this.state = "running";
        record.state = this.state;
      }

      async close() {
        const record = state.audioContexts[this.id - 1];
        record.closeCalls += 1;
        this.state = "closed";
        record.state = this.state;
      }
    }
    Object.defineProperty(window, "AudioContext", { configurable: true, value: MockAudioContext });

    class MockPeerConnection extends EventTarget {
      readonly id: number;
      iceGatheringState: RTCIceGatheringState = "complete";
      connectionState: RTCPeerConnectionState = "new";
      localDescription: RTCSessionDescriptionInit | null = null;
      ontrack: ((event: RTCTrackEvent) => void) | null = null;
      onconnectionstatechange: (() => void) | null = null;

      constructor() {
        super();
        this.id = state.peerConnections.length + 1;
        state.counters.peerConnections += 1;
        state.peerConnections.push({ id: this.id, closed: false, closeCalls: 0, offerCalls: 0 });
      }

      addTransceiver() {
        return {} as RTCRtpTransceiver;
      }

      async createOffer() {
        const record = state.peerConnections[this.id - 1];
        record.offerCalls += 1;
        const failure = state.failures.createOffer;
        delete state.failures.createOffer;
        if (failure) throw new Error(failure);
        if (state.nextOfferPending) {
          state.nextOfferPending = false;
          await new Promise<void>((resolve, reject) => {
            state.pendingOffers[this.id] = {
              resolve: () => {
                delete state.pendingOffers[this.id];
                resolve();
              },
              reject: (message) => {
                delete state.pendingOffers[this.id];
                reject(new Error(message));
              },
            };
          });
        }
        return { type: "offer" as const, sdp: `mock-offer-${this.id}` };
      }

      async setLocalDescription(description: RTCSessionDescriptionInit) {
        this.localDescription = description;
      }

      async setRemoteDescription() {}

      close() {
        const record = state.peerConnections[this.id - 1];
        record.closeCalls += 1;
        record.closed = true;
        this.connectionState = "closed";
      }
    }
    Object.defineProperty(window, "RTCPeerConnection", { configurable: true, value: MockPeerConnection });

    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: async () => {
        state.counters.mediaPlay += 1;
        state.mediaPlayCalls += 1;
      },
    });

    (window as unknown as {
      __browserMocks: {
        state: MockState;
        sendFrame(socketId: number, frame: unknown): void;
        closeSocket(socketId: number, clean: boolean): void;
      };
    }).__browserMocks = {
      state,
      sendFrame(socketId, frame) {
        socketById(socketId).dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }));
      },
      closeSocket,
    };
  });
}

export async function sendServerFrame(page: Page, frame: unknown, socketId?: number): Promise<void> {
  await page.evaluate(
    ({ frame, socketId }) => {
      const mocks = (window as unknown as {
        __browserMocks: { state: LifecycleState; sendFrame(id: number, value: unknown): void };
      }).__browserMocks;
      const id = socketId ?? mocks.state.sockets.at(-1)?.id;
      if (!id) throw new Error("No socket available");
      mocks.sendFrame(id, frame);
    },
    { frame, socketId },
  );
}

export async function sendReadyFrame(page: Page, options: ReadyFrameOptions = {}, socketId?: number): Promise<void> {
  await sendServerFrame(page, {
    t: "ready",
    config: {
      mode: options.mode ?? "model",
      activeMode: options.activeMode ?? "gated",
      agentName: options.agentName ?? "Lifecycle Agent",
      safeQuestions: ["What can you help with?"],
      avatarCharacter: "lisa",
      avatarStyle: "casual-sitting",
    },
    iceServers: [{ urls: ["stun:example.invalid"] }],
  }, socketId);
}

async function closeLatestSocket(page: Page, clean: boolean): Promise<void> {
  await page.evaluate((clean) => {
    const mocks = (window as unknown as {
      __browserMocks: { state: LifecycleState; closeSocket(id: number, clean: boolean): void };
    }).__browserMocks;
    const id = mocks.state.sockets.at(-1)?.id;
    if (!id) throw new Error("No socket available");
    mocks.closeSocket(id, clean);
  }, clean);
}

export async function closeLatestSocketCleanly(page: Page): Promise<void> {
  await closeLatestSocket(page, true);
}

export async function closeLatestSocketUnexpectedly(page: Page): Promise<void> {
  await closeLatestSocket(page, false);
}

export async function inspectLifecycle(page: Page): Promise<LifecycleState> {
  return page.evaluate(() => {
    const state = (window as unknown as { __browserMocks: { state: LifecycleState } }).__browserMocks.state;
    return structuredClone({
      counters: state.counters,
      currentSocketIds: state.currentSocketIds,
      sockets: state.sockets,
      streams: state.streams,
      audioContexts: state.audioContexts,
      peerConnections: state.peerConnections,
      mediaPlayCalls: state.mediaPlayCalls,
      getUserMediaCalls: state.getUserMediaCalls,
      disconnectedAudioNodes: state.disconnectedAudioNodes,
    });
  });
}

export async function failNext(page: Page, name: FailureName, message: string): Promise<void> {
  await page.evaluate(({ name, message }) => {
    const state = (window as unknown as {
      __browserMocks: { state: { failures: Partial<Record<FailureName, string>> } };
    }).__browserMocks.state;
    state.failures[name] = message;
  }, { name, message });
}

export async function deferNextResume(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __browserMocks: { state: { nextResumePending: boolean } } }).__browserMocks.state.nextResumePending = true;
  });
}

export async function deferNextCreateOffer(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __browserMocks: { state: { nextOfferPending: boolean } } }).__browserMocks.state.nextOfferPending = true;
  });
}

export async function settleResume(page: Page, contextId: number, error?: string): Promise<void> {
  await page.evaluate(({ contextId, error }) => {
    const pending = (window as unknown as {
      __browserMocks: { state: { pendingResumes: Record<number, { resolve(): void; reject(message: string): void }> } };
    }).__browserMocks.state.pendingResumes[contextId];
    if (!pending) throw new Error(`AudioContext ${contextId} has no pending resume`);
    if (error) pending.reject(error);
    else pending.resolve();
  }, { contextId, error });
}

export async function settleCreateOffer(page: Page, peerConnectionId: number, error?: string): Promise<void> {
  await page.evaluate(({ peerConnectionId, error }) => {
    const pending = (window as unknown as {
      __browserMocks: { state: { pendingOffers: Record<number, { resolve(): void; reject(message: string): void }> } };
    }).__browserMocks.state.pendingOffers[peerConnectionId];
    if (!pending) throw new Error(`Peer connection ${peerConnectionId} has no pending offer`);
    if (error) pending.reject(error);
    else pending.resolve();
  }, { peerConnectionId, error });
}

export function controlFrames(state: LifecycleState, socketId?: number): Array<Record<string, unknown>> {
  const socket = socketId ? state.sockets.find((candidate) => candidate.id === socketId) : state.sockets.at(-1);
  return (socket?.sent ?? [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => JSON.parse(value) as Record<string, unknown>);
}
