# Landing Controls Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Config and Transcript controls reliably visible, labeled, and accessible on the fullscreen landing page.

**Architecture:** Replace the two independently positioned, translucent icon controls with one fixed top-right toolbar rendered by `renderLandingView`. Keep the existing navigation and transcript-panel behavior, while using explicit high-contrast CSS and stacking rules at desktop and mobile sizes.

**Tech Stack:** TypeScript DOM APIs, CSS in the ASP.NET Core static host page, Playwright.

---

### Task 1: Add visible landing controls

**Files:**
- Modify: `web/frontend/tests/session-lifecycle.spec.ts`
- Modify: `web/frontend/src/views.ts:263-323`
- Modify: `web/src/VoiceLive.Web/wwwroot/index.html:158-216`
- Modify: `web/src/VoiceLive.Web/wwwroot/index.html:298-315`

- [ ] **Step 1: Write the failing browser test**

Add this test after the helper functions in
`web/frontend/tests/session-lifecycle.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd web/frontend
npm run build
npx playwright test tests/session-lifecycle.spec.ts --grep "landing controls are labeled"
```

Expected: FAIL because the landing page has no `Landing controls` navigation
element and the existing controls do not have the visible `Config` and
`Transcript` labels.

- [ ] **Step 3: Group and label the controls**

In `renderLandingView` in `web/frontend/src/views.ts`, create the toolbar before
the Config link:

```ts
  const actions = document.createElement("nav");
  actions.className = "landing-actions";
  actions.setAttribute("aria-label", "Landing controls");

  const gear = document.createElement("a");
  gear.className = "landing-action landing-config";
  gear.href = "?view=operator";
  gear.textContent = "⚙ Config";
  gear.setAttribute("aria-label", "Config");
  gear.title = "Config";
```

Replace the transcript button setup with:

```ts
  const transcriptToggle = document.createElement("button");
  transcriptToggle.type = "button";
  transcriptToggle.className = "landing-action landing-transcript-toggle";
  transcriptToggle.textContent = "💬 Transcript";
  transcriptToggle.setAttribute("aria-label", "Transcript");
  transcriptToggle.title = "Transcript";

  actions.append(gear, transcriptToggle);
```

Replace the landing root append call with:

```ts
  root.append(avatar, pill, actions, panel, notice, errorOverlay, reconnectButton);
```

- [ ] **Step 4: Add high-contrast toolbar styling**

Replace the existing `.landing-gear` and `.landing-transcript-toggle` rules in
`web/src/VoiceLive.Web/wwwroot/index.html` with:

```css
      .landing-actions {
        position: fixed;
        top: 1rem;
        right: 1rem;
        z-index: 3;
        display: flex;
        gap: 0.5rem;
      }

      .landing-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 2.75rem;
        border: 1px solid rgb(18 24 38 / 18%);
        border-radius: 999px;
        background: #fff;
        box-shadow: 0 0.25rem 1rem rgb(0 0 0 / 35%);
        color: #121826;
        font-weight: 650;
        line-height: 1;
        padding: 0.75rem 1rem;
        text-decoration: none;
      }

      .landing-action:hover,
      .landing-action:focus-visible {
        background: #eef2ff;
      }
```

Remove the old fixed-position `.landing-transcript-toggle` rule. Add an explicit
stacking level to the transcript panel:

```css
      .landing-transcript {
        z-index: 2;
      }
```

Inside the existing `@media (max-width: 760px)` block, add:

```css
        .landing-actions {
          top: 0.75rem;
          right: 0.75rem;
          gap: 0.375rem;
        }

        .landing-action {
          min-height: 2.5rem;
          padding: 0.625rem 0.75rem;
        }
```

- [ ] **Step 5: Run the targeted test**

Run:

```bash
cd web/frontend
npm run build
npx playwright test tests/session-lifecycle.spec.ts --grep "landing controls are labeled"
```

Expected: 1 test passes in Chromium.

- [ ] **Step 6: Run the complete frontend test suite**

Run:

```bash
cd web/frontend
npm test
```

Expected: TypeScript type-checking and all Playwright tests pass.

- [ ] **Step 7: Commit the implementation**

```bash
git add web/frontend/tests/session-lifecycle.spec.ts \
  web/frontend/src/views.ts \
  web/src/VoiceLive.Web/wwwroot/index.html \
  web/src/VoiceLive.Web/wwwroot/app.js
git commit -m "fix(web): show landing controls" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" \
  -m "Copilot-Session: 0bc8af99-30cd-4990-8a1c-7fd98ce769ef"
```

