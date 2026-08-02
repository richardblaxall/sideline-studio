# Secrets & configuration

Secrets live in **two homes** because the pipeline is split across two runtimes:

- **The app** runs on the Cloudflare Workers runtime (Lovable Cloud). It reads from Supabase,
  mints HiDrive REST sharelinks, and — via the authenticated `/api/ingest/*` routes — performs
  **all** Supabase writes on the worker's behalf (row upserts + storage uploads). Pure JS, no
  native deps.
- **The ingest worker** (`/worker`) runs standalone on a VPS under Node. It owns the heavy image
  work (HiDrive WebDAV reads, metadata parsing, `sharp` derivatives), then POSTs the finished
  result to the app. It holds **no Supabase credentials** — Lovable Cloud does not expose the
  service-role key / database URL outside the app runtime.

> **What is testable when.** Modules 1–4 + 6 — the storage buckets, the WebDAV ingest, the
> metadata parser, and the public + private preview generation, plus the poller — are testable
> once the **app is published** (the worker POSTs to `/api/ingest/*`, so those routes must exist
> on the deployed origin and `INGEST_RECEIVE_SECRET` must be set app-side) using the WebDAV
> credentials + `APP_INGEST_URL` + `INGEST_RECEIVE_SECRET` on the VPS worker. Ingested photos
> land hidden (`is_published=false`), so you can push one through and inspect it privately before
> publishing. **Only the in-app download half (module 5, `downloadOriginal` sharelinks) depends
> on the HiDrive REST credential** (`HIDRIVE_CLIENT_ID` / `HIDRIVE_CLIENT_SECRET` /
> `HIDRIVE_REFRESH_TOKEN`). You can ship and verify everything else before that credential clears.

## 1. App secrets — set as Lovable Cloud secrets (see `.env.example`)

| Key | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL (managed by Lovable Cloud). |
| `SUPABASE_PUBLISHABLE_KEY` | Anon/publishable key used by the auth middleware. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key used by server functions + the `/api/ingest/*` routes (bypasses RLS). |
| `INGEST_RECEIVE_SECRET` | Shared secret the worker must present (`x-ingest-secret`) to the `/api/ingest/receive` + `/api/ingest/check` routes. Set to the same value on the worker. |
| `HIDRIVE_CLIENT_ID` | HiDrive OAuth2 app client id. **(module 5 only)** |
| `HIDRIVE_CLIENT_SECRET` | HiDrive OAuth2 app client secret. **(module 5 only)** |
| `HIDRIVE_REFRESH_TOKEN` | HiDrive OAuth2 refresh token. **(module 5 only)** |
| `HIDRIVE_REST_PATH_PREFIX` | Absolute HiDrive user root, e.g. `/users/<loginname>`. Prepended to the stored relative path to form the absolute path for sharelinks/zip. |
| `HIDRIVE_ARCHIVE_DIR` | *(optional)* Where server-side ZIPs are written. Defaults to `<prefix>/.sideline-archives`. |

`VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` are public build-time values.

## 2. Ingest worker secrets — set in the VPS environment (see `worker/.env.example`)

| Key | Purpose |
| --- | --- |
| `HIDRIVE_WEBDAV_URL` | WebDAV base incl. user root. IONOS: `https://webdav.hidrive.ionos.com/users/<loginname>/` (Strato: `…strato.com…`). `hidrive_original_path` is stored relative to this. |
| `HIDRIVE_WEBDAV_USER` | HiDrive WebDAV username. |
| `HIDRIVE_WEBDAV_PASS` | HiDrive WebDAV password. |
| `APP_INGEST_URL` | Base URL of the published app (e.g. `https://<app>.lovable.app`). The worker POSTs finished derivatives + metadata to `${APP_INGEST_URL}/api/ingest/*`. |
| `INGEST_RECEIVE_SECRET` | Shared secret for the app's `/api/ingest/*` routes — **same value** as the app-side secret. No Supabase creds live on the worker. |
| `BRAND` | Brand name shown in the watermark text. |
| `HIDRIVE_INGEST_FOLDER` | Folder (relative to the WebDAV base) the poller scans. Default `ingest/`. |
| `INGEST_TRIGGER_SECRET` | Shared secret for the optional Make.com HTTP trigger (`npm run serve`). |

## Notes

- **Never commit real secrets.** The tracked `.env` intentionally holds only public
  (publishable) Supabase values, per the Lovable convention; everything sensitive is injected
  at runtime. `.env.example` and `worker/.env.example` are documentation only.
- Credentials are only ever placed in `Authorization` headers and are never logged.
- The HiDrive REST parameter names for `/sharelink` and `/file/archive/deflate` should be
  re-confirmed against <https://developer.hidrive.com> the first time module 5 runs.
