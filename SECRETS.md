# Secrets & configuration

Secrets live in **two homes** because the pipeline is split across two runtimes:

- **The app** runs on the Cloudflare Workers runtime (Lovable Cloud). It only reads from
  Supabase and mints HiDrive REST sharelinks — pure JS, no native deps.
- **The ingest worker** (`/worker`) runs standalone on a VPS under Node. It owns all the heavy
  work (HiDrive WebDAV reads, metadata parsing, `sharp` derivatives, uploads).

> **What is testable when.** Modules 1–4 + 6 — the storage buckets, the WebDAV ingest, the
> metadata parser, and the public + private preview generation, plus the poller — are **fully
> testable now** using only the WebDAV + Supabase credentials on the VPS worker. **Only the
> in-app download half (module 5, `downloadOriginal` sharelinks) depends on the HiDrive REST
> credential** (`HIDRIVE_CLIENT_ID` / `HIDRIVE_CLIENT_SECRET` / `HIDRIVE_REFRESH_TOKEN`). You
> can ship and verify everything else before that credential clears.

## 1. App secrets — set as Lovable Cloud secrets (see `.env.example`)

| Key | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL (managed by Lovable Cloud). |
| `SUPABASE_PUBLISHABLE_KEY` | Anon/publishable key used by the auth middleware. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key used by server functions (bypasses RLS). |
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
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (VPS only — bypasses RLS to write rows + storage). |
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
