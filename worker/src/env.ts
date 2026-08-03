// Central env access for the ingest worker. All secrets come from process.env
// (loaded on the VPS via the process manager / a .env file — see worker/.env.example).
// Never log the values here.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  // HiDrive WebDAV (classic HiDrive). Base URL includes the user root, e.g.
  //   https://webdav.hidrive.ionos.com/users/<loginname>/
  // hidrive_original_path values are stored RELATIVE to this base (no leading slash).
  get HIDRIVE_WEBDAV_URL(): string {
    const url = required("HIDRIVE_WEBDAV_URL");
    return url.endsWith("/") ? url : `${url}/`;
  },
  get HIDRIVE_WEBDAV_USER(): string {
    return required("HIDRIVE_WEBDAV_USER");
  },
  get HIDRIVE_WEBDAV_PASS(): string {
    return required("HIDRIVE_WEBDAV_PASS");
  },

  // The app's ingest API base URL (the published app origin, e.g. https://<app>.lovable.app).
  // The worker POSTs finished derivatives + metadata here; the app does all Supabase writes.
  get APP_INGEST_URL(): string {
    return required("APP_INGEST_URL").replace(/\/+$/, "");
  },
  // Shared secret for the app's /api/ingest/* routes (must match the app's INGEST_RECEIVE_SECRET).
  get INGEST_RECEIVE_SECRET(): string {
    return required("INGEST_RECEIVE_SECRET");
  },

  // Brand word used in the watermark text ("© <BRAND>"). Blank falls back to "Photerior".
  get BRAND(): string {
    return optional("BRAND", "Photerior");
  },

  // Folder (relative to HIDRIVE_WEBDAV_URL) the poller scans for new masters.
  get HIDRIVE_INGEST_FOLDER(): string {
    return optional("HIDRIVE_INGEST_FOLDER", "ingest/");
  },

  // Shared secret required by the optional HTTP trigger (Make.com etc.).
  get INGEST_TRIGGER_SECRET(): string {
    return optional("INGEST_TRIGGER_SECRET");
  },

  // Port for the optional HTTP trigger server.
  get PORT(): number {
    return Number(optional("PORT", "8787"));
  },
};
