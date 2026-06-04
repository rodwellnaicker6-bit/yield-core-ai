---
name: app_preview screenshots capture from top
description: Why JS-scrolling to frame below-the-fold UI for a screenshot does not work
---
The `app_preview` screenshot tool renders/captures the page from the top (scroll position 0). Programmatically scrolling (`scrollIntoView`, setting `#content.scrollTop`, persistent intervals) does NOT move what gets captured — repeated attempts all return the same top-of-page frame.

**Why:** the tool framing is fixed to the top viewport, independent of runtime scroll state.

**How to apply:** to visually verify a below-the-fold section, do not try to scroll via injected JS. Either (a) temporarily reorder/elevate that section to the top, (b) render it in isolation, or (c) rely on JS-parse + load checks + architect review instead of a screenshot. Don't burn multiple screenshot calls trying to scroll.

Side note for this app: the dashboard is gated client-side by `localStorage 'yc_token'`; a fresh screenshot always shows the login page. A temporary `?previewdemo=1` bypass that calls `enterApp()` (added then reverted) is the way to render the authed dashboard for a top-of-page screenshot.
