import { expect, test } from "@playwright/test";
import {
  closeLatestSocketCleanly,
  closeLatestSocketUnexpectedly,
  controlFrames,
  deferNextCreateOffer,
  deferNextResume,
  failNext,
  inspectLifecycle,
  installBrowserMocks,
  sendReadyFrame,
  sendServerFrame,
  settleCreateOffer,
  settleResume,
} from "./browser-mocks";

test.beforeEach(async ({ page }) => {
  await installBrowserMocks(page);
});

async function openOperator(page: Parameters<typeof installBrowserMocks>[0]) {
  await page.goto("/?view=operator");
  await expect.poll(async () => (await inspectLifecycle(page)).sockets.length).toBe(1);
}

async function readyOperator(page: Parameters<typeof installBrowserMocks>[0], activeMode: "gated" | "open-mic" | "hybrid" = "gated") {
  await sendReadyFrame(page, { activeMode });
  await expect(page.getByText("microphone: ready (24000 Hz context)")).toBeVisible();
  if (activeMode !== "gated") {
    await expect(page.getByText(`turn: ${activeMode}: streaming continuously`)).toBeVisible();
  }
}

async function openDisplay(page: Parameters<typeof installBrowserMocks>[0]) {
  await page.goto("/?view=display");
  await expect.poll(async () => (await inspectLifecycle(page)).sockets.length).toBe(1);
}

async function readyDisplay(page: Parameters<typeof installBrowserMocks>[0]) {
  await sendReadyFrame(page);
  await expect.poll(async () => (await inspectLifecycle(page)).peerConnections.at(-1)?.offerCalls).toBe(1);
  await expect(page.getByText("webrtc: offer sent; waiting for answer")).toBeVisible();
}

test("display reconnects with fresh resources after clean socket closure", async ({ page }) => {
  await openDisplay(page);
  await readyDisplay(page);

  await closeLatestSocketCleanly(page);
  const reconnect = page.getByRole("button", { name: "Reconnect" });
  await expect(reconnect).toBeVisible();

  await reconnect.click();
  await expect.poll(async () => (await inspectLifecycle(page)).sockets.length).toBe(2);
  await readyDisplay(page);

  const state = await inspectLifecycle(page);
  expect(state.sockets).toHaveLength(2);
  expect(state.peerConnections).toHaveLength(2);
  expect(state.peerConnections[0]).toMatchObject({ closed: true, closeCalls: 1 });
  expect(state.peerConnections[1].closed).toBe(false);
  expect(state.getUserMediaCalls).toBe(0);
  expect(state.audioContexts).toHaveLength(0);
  await expect(reconnect).toBeHidden();
});

test("display unexpected closure retains the error and offers reconnect", async ({ page }) => {
  await openDisplay(page);
  await readyDisplay(page);

  await closeLatestSocketUnexpectedly(page);

  await expect(page.getByRole("alert")).toContainText("WebSocket closed unexpectedly");
  await expect(page.getByRole("button", { name: "Reconnect" })).toBeVisible();
});

test("socket closure tears down browser resources and offers reconnect", async ({ page }) => {
  await openOperator(page);
  await readyOperator(page);

  await closeLatestSocketCleanly(page);

  await expect(page.getByRole("button", { name: "Reconnect" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hold to talk" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Stop speaking" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Repeat last answer" })).toBeDisabled();
  await expect.poll(async () => (await inspectLifecycle(page)).audioContexts[0]?.state).toBe("closed");
  const state = await inspectLifecycle(page);
  expect(state.streams[0].stoppedTracks).toBe(1);
  expect(state.audioContexts[0]).toMatchObject({ sampleRate: 24_000, closeCalls: 1 });
  expect(state.peerConnections[0]).toMatchObject({ closed: true, closeCalls: 1 });
  expect(state.currentSocketIds).toEqual([]);
});

test("clean closure is nonfatal while unexpected closure reports an error", async ({ page }) => {
  await openOperator(page);
  await readyOperator(page);
  await closeLatestSocketCleanly(page);
  await expect(page.getByRole("alert")).toBeHidden();

  await page.getByRole("button", { name: "Reconnect" }).click();
  await expect.poll(async () => (await inspectLifecycle(page)).sockets.length).toBe(2);
  await readyOperator(page);
  await closeLatestSocketUnexpectedly(page);
  await expect(page.getByRole("alert")).toContainText("WebSocket closed unexpectedly");
});

test("reconnect creates fresh resources and can become ready again", async ({ page }) => {
  await openOperator(page);
  await readyOperator(page);
  await closeLatestSocketCleanly(page);

  await page.getByRole("button", { name: "Reconnect" }).click();
  await expect.poll(async () => (await inspectLifecycle(page)).sockets.length).toBe(2);
  await readyOperator(page, "open-mic");

  const state = await inspectLifecycle(page);
  expect(state.sockets).toHaveLength(2);
  expect(state.streams).toHaveLength(2);
  expect(state.audioContexts).toHaveLength(2);
  expect(state.peerConnections).toHaveLength(2);
  expect(state.streams[0].stoppedTracks).toBe(1);
  expect(state.audioContexts[0].state).toBe("closed");
  expect(state.audioContexts[1].state).toBe("running");
  await expect(page.getByText("connection: ready")).toBeVisible();
});

test("microphone setup failure tears down its track and offers reconnect", async ({ page }) => {
  await openOperator(page);
  await failNext(page, "audioWorklet", "worklet failed");
  await sendReadyFrame(page);

  await expect(page.getByRole("alert")).toContainText("Microphone setup failed: worklet failed");
  await expect(page.getByRole("button", { name: "Reconnect" })).toBeVisible();
  await expect.poll(async () => (await inspectLifecycle(page)).streams[0]?.stoppedTracks).toBe(1);
  const state = await inspectLifecycle(page);
  expect(state.audioContexts[0].state).toBe("closed");
  expect(state.peerConnections[0].closed).toBe(true);
});

test("avatar negotiation failure tears down and offers reconnect", async ({ page }) => {
  await openOperator(page);
  await deferNextCreateOffer(page);
  await sendReadyFrame(page);
  await expect.poll(async () => (await inspectLifecycle(page)).peerConnections[0]?.offerCalls).toBe(1);
  await settleCreateOffer(page, 1, "offer failed");

  await expect(page.getByRole("alert")).toContainText("Avatar WebRTC negotiation failed: offer failed");
  await expect(page.getByRole("button", { name: "Reconnect" })).toBeVisible();
  const state = await inspectLifecycle(page);
  expect(state.peerConnections[0].closed).toBe(true);
  expect(state.streams).toHaveLength(0);
  expect(state.audioContexts).toHaveLength(0);
});

test("avatar capacity error keeps the voice session connected", async ({ page }) => {
  await openOperator(page);
  await readyOperator(page);
  await sendServerFrame(page, { t: "avatar-error", code: "capacity", message: "No avatar capacity" });

  await expect(page.getByRole("status")).toContainText("Avatar unavailable: No avatar capacity");
  await expect(page.getByText("connection: ready")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect" })).toBeHidden();
  await expect(page.getByRole("alert")).toBeHidden();
  const state = await inspectLifecycle(page);
  expect(state.peerConnections[0].closed).toBe(true);
  expect(state.audioContexts[0].state).not.toBe("closed");
  expect(state.streams[0].stoppedTracks).toBe(0);
});

test("releasing a gated turn while resume is pending never starts it", async ({ page }) => {
  await openOperator(page);
  await readyOperator(page);
  await deferNextResume(page);

  const hold = page.getByRole("button", { name: "Hold to talk" });
  await hold.dispatchEvent("pointerdown");
  await expect.poll(async () => (await inspectLifecycle(page)).audioContexts[0].resumeCalls).toBe(1);
  await hold.dispatchEvent("pointerup");
  await settleResume(page, 1);

  await expect.poll(async () => controlFrames(await inspectLifecycle(page)).filter((frame) => frame.t === "start-turn").length).toBe(0);
  await expect(hold).not.toHaveClass(/active/);
});

test("stale gated resume rejection cannot overwrite a reconnected session", async ({ page }) => {
  await openOperator(page);
  await readyOperator(page);
  await deferNextResume(page);
  await page.getByRole("button", { name: "Hold to talk" }).dispatchEvent("pointerdown");
  await expect.poll(async () => (await inspectLifecycle(page)).audioContexts[0].resumeCalls).toBe(1);

  await closeLatestSocketUnexpectedly(page);
  await page.getByRole("button", { name: "Reconnect" }).click();
  await expect.poll(async () => (await inspectLifecycle(page)).sockets.length).toBe(2);
  await readyOperator(page);
  await settleResume(page, 1, "stale resume failed");

  await expect(page.getByRole("alert")).toBeHidden();
  await expect(page.getByText("connection: ready")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect" })).toBeHidden();
});

test("landing controls are labeled and visible above the avatar", async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const actions = page.getByRole("navigation", { name: "Landing controls" });
    const config = page.getByRole("link", { name: "Config" });
    const transcript = page.getByRole("button", { name: "Transcript" });

    await expect(actions).toBeVisible();
    await expect(actions).toHaveCSS("z-index", "3");
    await expect(config).toBeVisible();
    await expect(config).toHaveAttribute("href", "?view=operator");
    await expect(transcript).toBeVisible();

    const box = await actions.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

    await transcript.click();
    await expect(page.locator(".landing-transcript")).toHaveClass(/open/);
  }
});

test("transcript close panel button clears the open class on desktop 1280x720", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");

  await page.getByRole("button", { name: "Transcript" }).click();
  await expect(page.locator(".landing-transcript")).toHaveClass(/open/);

  // Close button must not be geometrically covered by the toolbar
  const toolbarBox = await page.getByRole("navigation", { name: "Landing controls" }).boundingBox();
  const closeBox = await page.getByRole("button", { name: "Close panel" }).boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(closeBox).not.toBeNull();
  expect(closeBox!.y).toBeGreaterThanOrEqual(toolbarBox!.y + toolbarBox!.height);

  // Clicking the button must actually close the panel
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(page.locator(".landing-transcript")).not.toHaveClass(/open/);
});

test("pill and notice do not overlap the toolbar on mobile 390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "Landing controls" })).toBeVisible();
  const toolbarBox = await page.getByRole("navigation", { name: "Landing controls" }).boundingBox();
  expect(toolbarBox).not.toBeNull();

  // Reveal pill and notice via DOM manipulation for layout testing
  await page.evaluate(() => {
    const pill = document.querySelector<HTMLElement>(".landing-pill");
    const notice = document.querySelector<HTMLElement>(".landing-notice");
    if (pill) { pill.hidden = false; pill.textContent = "Connecting\u2026"; }
    if (notice) { notice.hidden = false; notice.textContent = "Non-fatal notice"; }
  });

  const pillBox = await page.locator(".landing-pill").boundingBox();
  const noticeBox = await page.locator(".landing-notice").boundingBox();
  expect(pillBox).not.toBeNull();
  expect(noticeBox).not.toBeNull();

  const toolbarBottom = toolbarBox!.y + toolbarBox!.height;
  // Both elements must start at or below the toolbar bottom edge
  expect(pillBox!.y).toBeGreaterThanOrEqual(toolbarBottom);
  expect(noticeBox!.y).toBeGreaterThanOrEqual(toolbarBottom);
});

test("landing error overlay stacks above open transcript panel and actions", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");

  // Open the transcript panel so it has a rendered presence on screen
  await page.getByRole("button", { name: "Transcript" }).click();
  await expect(page.locator(".landing-transcript")).toHaveClass(/open/);
  // Wait for the 0.2s slide-in CSS transition to finish; without this the
  // bounding-box query races against the animation and the centre point can
  // be reported outside the viewport.
  await expect(page.locator(".landing-transcript")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

  // Simulate setError being called (mirrors what disconnect() does when it calls fail())
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".landing-error");
    if (el) {
      el.hidden = false;
      el.textContent = "Test fatal error";
    }
  });
  await expect(page.locator(".landing-error")).toBeVisible();

  // The error overlay must render above the open transcript panel.
  // Probe a point inside the transcript panel; elementFromPoint should hit the
  // error overlay (z-index 4), not the transcript (z-index 2).
  const transcriptBox = await page.locator(".landing-transcript").boundingBox();
  expect(transcriptBox).not.toBeNull();
  const txProbeX = transcriptBox!.x + transcriptBox!.width / 2;
  const txProbeY = transcriptBox!.y + transcriptBox!.height / 2;

  const errorAboveTranscript = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    const error = document.querySelector(".landing-error");
    return !!hit && !!error && (hit === error || error.contains(hit));
  }, { x: txProbeX, y: txProbeY });
  expect(errorAboveTranscript).toBe(true);

  // The error overlay must also render above the actions toolbar (z-index 3).
  const actionsBox = await page.locator(".landing-actions").boundingBox();
  expect(actionsBox).not.toBeNull();
  const axProbeX = actionsBox!.x + actionsBox!.width / 2;
  const axProbeY = actionsBox!.y + actionsBox!.height / 2;

  const errorAboveActions = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    const error = document.querySelector(".landing-error");
    return !!hit && !!error && (hit === error || error.contains(hit));
  }, { x: axProbeX, y: axProbeY });
  expect(errorAboveActions).toBe(true);
});

test("reconnect button remains clickable while landing error overlay is visible", async ({ page }) => {
  await page.goto("/");
  await expect.poll(async () => (await inspectLifecycle(page)).sockets.length).toBe(1);

  await closeLatestSocketUnexpectedly(page);

  const errorOverlay = page.locator(".landing-error");
  const reconnect = page.locator(".landing-reconnect");

  await expect(errorOverlay).toBeVisible();
  await expect(reconnect).toBeVisible();

  // Reconnect must sit above the full-screen error overlay: required z-index 5 > 4
  await expect(reconnect).toHaveCSS("z-index", "5");
  await expect(errorOverlay).toHaveCSS("z-index", "4");

  // elementFromPoint at the reconnect button center must resolve to the reconnect button,
  // not to the error overlay underneath it.
  const reconnectBox = await reconnect.boundingBox();
  expect(reconnectBox).not.toBeNull();
  const cx = reconnectBox!.x + reconnectBox!.width / 2;
  const cy = reconnectBox!.y + reconnectBox!.height / 2;
  const hitsReconnect = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    const btn = document.querySelector(".landing-reconnect");
    return !!hit && !!btn && (hit === btn || btn.contains(hit));
  }, { x: cx, y: cy });
  expect(hitsReconnect).toBe(true);

  // Clicking reconnect must open a new socket despite the overlay being visible.
  await reconnect.click();
  await expect.poll(async () => (await inspectLifecycle(page)).sockets.length).toBe(2);
});

test("reconnect button is above transcript panel on mobile and clickable after clean disconnect", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect.poll(async () => (await inspectLifecycle(page)).sockets.length).toBe(1);

  await page.getByRole("button", { name: "Transcript" }).click();
  await expect(page.locator(".landing-transcript")).toHaveClass(/open/);

  // Clean disconnect shows reconnect but no error overlay.
  await closeLatestSocketCleanly(page);

  const reconnect = page.locator(".landing-reconnect");
  await expect(reconnect).toBeVisible();

  // Reconnect must sit above the transcript bottom sheet: required z-index 5 > 2
  await expect(reconnect).toHaveCSS("z-index", "5");
  await expect(page.locator(".landing-transcript")).toHaveCSS("z-index", "2");

  // elementFromPoint at the reconnect button center must resolve to the reconnect button,
  // not to the transcript panel behind it.
  const reconnectBox = await reconnect.boundingBox();
  expect(reconnectBox).not.toBeNull();
  const cx = reconnectBox!.x + reconnectBox!.width / 2;
  const cy = reconnectBox!.y + reconnectBox!.height / 2;
  const hitsReconnect = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    const btn = document.querySelector(".landing-reconnect");
    return !!hit && !!btn && (hit === btn || btn.contains(hit));
  }, { x: cx, y: cy });
  expect(hitsReconnect).toBe(true);

  await reconnect.click();
  await expect.poll(async () => (await inspectLifecycle(page)).sockets.length).toBe(2);
});

test("pill and notice do not overlap toolbar at intermediate 900x800 viewport", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/");

  const toolbar = page.getByRole("navigation", { name: "Landing controls" });
  await expect(toolbar).toBeVisible();
  const toolbarBox = await toolbar.boundingBox();
  expect(toolbarBox).not.toBeNull();

  await page.evaluate(() => {
    const pill = document.querySelector<HTMLElement>(".landing-pill");
    const notice = document.querySelector<HTMLElement>(".landing-notice");
    if (pill) { pill.hidden = false; pill.textContent = "Connecting\u2026"; }
    if (notice) { notice.hidden = false; notice.textContent = "Non-fatal notice"; }
  });

  const pillBox = await page.locator(".landing-pill").boundingBox();
  const noticeBox = await page.locator(".landing-notice").boundingBox();
  expect(pillBox).not.toBeNull();
  expect(noticeBox).not.toBeNull();

  const toolbarBottom = toolbarBox!.y + toolbarBox!.height;
  expect(pillBox!.y).toBeGreaterThanOrEqual(toolbarBottom);
  expect(noticeBox!.y).toBeGreaterThanOrEqual(toolbarBottom);
});

test("landing notice stacks above open transcript panel on desktop 1024x768", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");

  // Open transcript panel and wait for the 0.2s slide-in transition to finish
  await page.getByRole("button", { name: "Transcript" }).click();
  await expect(page.locator(".landing-transcript")).toHaveClass(/open/);
  await expect(page.locator(".landing-transcript")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

  // Reveal the landing notice via direct DOM manipulation (mirrors noteNonFatal / avatar-error)
  await page.evaluate(() => {
    const notice = document.querySelector<HTMLElement>(".landing-notice");
    if (notice) {
      notice.hidden = false;
      notice.textContent = "Avatar unavailable: test error";
    }
  });
  await expect(page.locator(".landing-notice")).toBeVisible();

  // At 1024px the transcript panel (min(24rem,80vw)=384px) occupies the right side
  // and the centered notice (min(32rem,90vw)=512px) overlaps it — verify that
  // the notice (z-index 3) is the hit target in the overlapping region, not the panel (z-index 2).
  const noticeBox = await page.locator(".landing-notice").boundingBox();
  const panelBox = await page.locator(".landing-transcript").boundingBox();
  expect(noticeBox).not.toBeNull();
  expect(panelBox).not.toBeNull();

  const overlapLeft = Math.max(noticeBox!.x, panelBox!.x);
  const overlapRight = Math.min(noticeBox!.x + noticeBox!.width, panelBox!.x + panelBox!.width);
  expect(overlapRight).toBeGreaterThan(overlapLeft);

  const probeX = (overlapLeft + overlapRight) / 2;
  const probeY = noticeBox!.y + noticeBox!.height / 2;

  const noticeIsHitTarget = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    const notice = document.querySelector(".landing-notice");
    return !!hit && !!notice && (hit === notice || notice.contains(hit));
  }, { x: probeX, y: probeY });
  expect(noticeIsHitTarget).toBe(true);
});

test("reconnect with changed mode replaces old gated and mute handlers", async ({ page }) => {
  await page.goto("/");
  await expect.poll(async () => (await inspectLifecycle(page)).sockets.length).toBe(1);
  await sendReadyFrame(page, { activeMode: "gated" });
  await expect.poll(async () => (await inspectLifecycle(page)).audioContexts.length).toBe(1);
  const talk = page.locator(".landing-talk");
  await expect(talk).toBeEnabled();

  await closeLatestSocketCleanly(page);
  await page.getByRole("button", { name: "Reconnect" }).click();
  await expect.poll(async () => (await inspectLifecycle(page)).sockets.length).toBe(2);
  await sendReadyFrame(page, { activeMode: "open-mic" });
  await expect.poll(async () => (await inspectLifecycle(page)).audioContexts[1]?.state).toBe("running");
  await expect(talk).toContainText("Listening");
  await talk.dispatchEvent("pointerdown");
  expect(controlFrames(await inspectLifecycle(page), 2).filter((frame) => frame.t === "start-turn")).toHaveLength(0);
  await talk.dispatchEvent("click");
  await expect(talk).toContainText("Muted");

  await closeLatestSocketCleanly(page);
  await page.getByRole("button", { name: "Reconnect" }).click();
  await expect.poll(async () => (await inspectLifecycle(page)).sockets.length).toBe(3);
  await sendReadyFrame(page, { activeMode: "gated" });
  await expect.poll(async () => (await inspectLifecycle(page)).audioContexts.length).toBe(3);
  await expect(talk).toContainText("Hold to talk");
  await talk.dispatchEvent("click");
  await expect(talk).not.toContainText("Muted");
  expect(controlFrames(await inspectLifecycle(page), 3).filter((frame) => frame.t === "start-turn")).toHaveLength(0);
  await talk.dispatchEvent("pointerdown");
  await expect.poll(async () => controlFrames(await inspectLifecycle(page), 3).filter((frame) => frame.t === "start-turn").length).toBe(1);
});
