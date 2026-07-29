# Landing Controls Visibility Design

## Problem

The fullscreen landing page renders the configuration and transcript controls,
but their translucent backgrounds and emoji glyphs have insufficient contrast
against dark avatar video. The controls also rely on automatic stacking rather
than explicitly appearing above the video and landing overlays.

## Design

Group the controls in a top-right `.landing-actions` toolbar. The toolbar will
contain:

- A `Config` link that continues to navigate to `?view=operator`.
- A `Transcript` button that continues to toggle the existing transcript panel.

Both controls will use visible text labels, high-contrast opaque styling, and an
explicit stacking level above the avatar. The toolbar will remain within the
viewport and use compact sizing on narrow screens.

The existing transcript panel behavior remains unchanged: it opens from the
right on larger screens and from the bottom on narrow screens. Session,
authentication, WebSocket, and backend behavior are out of scope.

## Accessibility

The controls will retain descriptive accessible names. Visible labels will
match their purpose, and keyboard activation will continue to use native link
and button behavior.

## Testing

Playwright coverage will verify at desktop and mobile viewport sizes that:

- `Config` and `Transcript` are visible and have their expected labels.
- Both controls stack above the avatar.
- Activating `Transcript` opens the existing transcript panel.
- Activating `Config` retains the `?view=operator` destination.

