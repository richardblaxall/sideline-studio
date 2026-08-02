## Goal

Three changes: drop the EXIF/"Capture data" block, replace per-gallery passcodes with a single global client login, remove the hover magnification lens.

## 1. Remove "Capture data"

- Delete the Capture data section and the `ExifRow` helper from the metadata drawer. Drawer keeps image, headline, caption, athlete badges, download button, copyright line.
- Leave the `exif_data` column in the database untouched (harmless, no UI reads it).

## 2. Global client login

Today access is per-event: the login checks `event_access` rows for that event and mints a token scoped to one event id. New behaviour:

- One shared client passcode stored as a server-side secret (`SIDELINE_CLIENT_PASSCODE`). Nothing ships to the browser.
- `verifyAccess` takes just a passcode, compares it timing-safely to the secret, and mints a token with a global scope (`sub: "all"`) instead of an event id.
- `getCleanPreviews` and `downloadOriginal` accept a globally scoped token and stop requiring the event to match.
- Access context becomes `isUnlocked` (a single boolean) instead of `isUnlockedFor(eventId)`; clean previews are fetched per gallery on demand once unlocked, so unlocking on one match keeps every other gallery and download unlocked while browsing.
- Login modal simplifies to one passcode field — no access-token field, no "open a gallery first" state — and can be opened from anywhere including the home page.
- Header shows "Client mode · Lock" whenever unlocked, independent of route.
- The `?token=…` deep-link path and the per-event `event_access` table stop being used by the UI (table left in place).

## 3. Remove the hover lens

- Strip the lens state, `requestAnimationFrame` tracking, mouse-move handlers and the lens overlay from the photo tile. Keep the hover caption, selection checkbox, drag/right-click protection, and click-to-open-drawer.

## Technical notes

Files touched: `src/components/sideline/metadata-drawer.tsx`, `photo-tile.tsx`, `login-modal.tsx`, `site-header.tsx`, `access-provider.tsx`, `src/lib/sideline.functions.ts`, `src/lib/sideline-access.server.ts`, `src/routes/index.tsx`, `src/routes/match.$id.tsx`. No migration required.

Unless you say otherwise I'll keep `sideline2025` as the shared client passcode (stored as a secret, easy to change later).
