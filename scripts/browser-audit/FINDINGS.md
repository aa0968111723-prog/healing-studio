# Browser-based site audit — 2026-05-03

Live walkthrough of every registered route in a headless Chromium against the
production build (`npm run build && npm run start` on `:4173`). Captures
screenshot, JS console errors, page-level errors, and any 4xx/5xx network
responses per route.

## Scope

- **38 routes** enumerated by combining `shared/appRegistry.ts` and
  `client/src/App.tsx <Route path="…">` declarations, plus a synthetic
  bogus path to exercise the SPA's 404 fallback.
- Headless: Chromium 141 (Playwright bundle), 1440×900 viewport.
- Auth: **none** (guest session). Auth-gated pages are expected to
  redirect to login and were verified to do so.
- Backend env: minimal — no DB, no LLM keys. Feature-flag-gated
  endpoints intentionally return 503 and are filtered as expected
  noise.

## How to re-run

```bash
npm run build
ORB_TOOL_ALLOWED_ORIGINS=http://localhost:4173 PORT=4173 \
  NODE_ENV=production node dist/index.js &
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  AUDIT_BASE_URL=http://localhost:4173 \
  node scripts/browser-audit/run-audit.mjs
# → scripts/browser-audit/report.md + report.json + screenshots/*.png
```

## Findings (initial pass — 38/38 routes had issues)

### 1. SVG `<circle cy="undefined">` on every page that mounts the home hero

**Files**: `client/src/pages/Home.tsx:750-757`

The "向下探索" scroll indicator used framer-motion to animate the inner
dot's `cy` attribute without an `initial` value:

```tsx
<motion.circle cx="8" cy="8" r="2" fill="currentColor"
  animate={{ cy: [8, 18, 8] }}
  transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
/>
```

On the very first frame (before motion's value pipeline ran) framer-motion
serialised `cy` as the literal string `"undefined"`, producing a Chromium
console error:

```
<circle> attribute cy: Expected length, "undefined".
```

This appeared on `/` and on `/account-settings` (which redirects through
the home page).

**Fix**: added `initial={{ cy: 8 }}` so framer-motion has a starting value
and never emits `undefined`.

### 2. `/account-settings` logged auth errors before redirecting

**Files**: `client/src/pages/AccountSettingsPage.tsx`

The page used its own raw `fetch("/api/auth/me")` instead of the
project-wide `useAuth()` hook. Two consequences for unauthenticated
visitors:

- The REST `/api/auth/me` endpoint replies `401`, which Chromium logs as
  `Failed to load resource: the server responded with a status of 401
  (Unauthorized)` regardless of how the JS code handles it.
- A second fetch to `/api/auth/login-history` fired in parallel and also
  produced a 401.

**Fix**: switched the page to use `useAuth({ redirectOnUnauthenticated:
true, redirectPath: "/" })`. `useAuth` goes through the tRPC
`auth.me` procedure, which returns `200 { user: null }` for guests
(no console 401) and triggers a clean redirect via `useEffect`. The
`/api/auth/login-history` fetch is now gated on `isAuthenticated`, so
guests never trigger it. Net effect: 2 console errors → 0.

### 3. Sandbox-only noise (NOT a code bug)

Every route also produced
`Failed to load resource: net::ERR_CERT_AUTHORITY_INVALID`. The host's
HTTPS to `fonts.googleapis.com` and `i.posthog.com` works fine, but the
headless Chromium under `/opt/pw-browsers/` ships an incomplete CA
bundle in this sandbox. Added to the audit's `isExpectedNoise` filter
so future runs aren't drowned by it.

## Findings (verification pass — after fixes)

| Pass | Routes | Routes with issues | Notes |
|------|--------|--------------------|-------|
| Initial               | 38 | **38** | SVG cy=undefined on 2 pages; 401 noise on /account-settings; cert noise on every page |
| After SVG fix         | 38 | **1**  | only /account-settings 401 noise |
| After auth-hook fix   | 38 | **0** ✓ | clean |

All 38 routes return 200, render visible content, and produce no JS
errors, console errors, or unexpected 4xx/5xx requests under a guest
session.

## Things observed but not changed

These are flagged for human judgement — they may be intentional.

### A. `ProactiveOrbWidget` is gated on `user`, but a test asserts it on guest sessions

`tests/e2e/orb-routes-smoke.spec.ts:40-48` asserts `#proactive-orb-anchor`
is mounted on `/` for guest sessions, with the comment
"On guest sessions the GlobalOrbChatProvider still renders it". But
`client/src/components/DashboardLayout.tsx:1001` only mounts
`ProactiveOrbWidget` when `user && location !== "/agent"`, and `/` is
rendered directly via `<Route path="/" component={Home} />` without any
`DashboardLayout` wrapper. So the orb anchor is **never** present on
the homepage for a guest.

This is either:
- a stale test that should be relaxed to "logged-in user" cases, or
- a regression where guest users used to see the orb anchor.

I have not changed either side without confirmation.

### B. Several routes still 200 for guests but immediately render the login overlay

This is by design — wouter has no auth-aware redirect at the route level;
each protected page redirects via `useAuth()` inside the component. The
audit confirms the redirect renders cleanly. If you'd prefer hard route
guards (a `<ProtectedRoute>` HOC that returns `<Redirect to="/login" />`
before the page mounts), that's a larger refactor.

### C. `/process` shows "看不到流程內容" without a `?spec=…` parameter

This is the documented empty-state for the share-link viewer when no
spec is attached, so it isn't a defect. The audit recorded it for
visibility.

## Hard limitations of this audit

- **No login**, so authed-state UI (sidebar, modality tabs, image-studio
  controls, etc.) was not exercised. To audit those, the script would need
  to call `/api/auth/login` with a seeded test user, store the cookie, and
  re-walk the routes.
- **No LLM keys**, so any chat / generation flow is rejected by the
  feature-flag layer with 503. The orb widget loads but cannot complete a
  turn.
- **No database**, so anything backed by `mysql2` is a no-op (login
  history was empty, dashboard counters were zero).
- **Single viewport** (1440×900). Mobile breakpoints, sidebar drawer
  behaviour, and bottom-sheet sheets were not exercised.
- **No interaction**, just navigation + settle. Click handlers, drag,
  forms, and keyboard shortcuts are not audited.

To go beyond this you'd need either an auth bootstrap step, an interactive
Playwright spec per page, or both.
