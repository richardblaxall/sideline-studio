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

  // Supabase (the worker uses the service-role key directly — never expose it).
  get SUPABASE_URL(): string {
    return required("SUPABASE_URL");
  },
  get SUPABASE_SERVICE_ROLE_KEY(): string {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },

  // Branding used in the watermark text.
  get BRAND(): string {
    return optional("BRAND", "SIDELINE STUDIO");
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
