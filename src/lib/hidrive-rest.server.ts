// HiDrive REST client (OAuth2) — the download/sharelink half of the pipeline.
//
// Pure JS (fetch only, no native deps) so it runs on the Cloudflare Workers app runtime.
// Server-only: this is a `.server.ts` module and must only be imported from other server code
// (the functions file loads it via `await import(...)`).
//
// Endpoints (classic HiDrive, https://developer.hidrive.com):
//   OAuth token : POST https://my.hidrive.com/oauth2/token   (grant_type=refresh_token)
//   Sharelink   : POST https://api.hidrive.strato.com/2.1/sharelink
//   ZIP archive : POST https://api.hidrive.strato.com/2.1/file/archive/deflate
//
// NOTE (verify before the REST credential clears): the exact archive/sharelink parameter names
// (src/dst/base/on_exist, ttl/maxcount) are taken from the HiDrive HTTP API reference and the
// community OpenAPI spec. Re-confirm against the live reference the first time these run — this
// half is intentionally not exercised until HIDRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN are set.
//
// SECURITY: credentials come from env, are only ever sent to HiDrive, and are never logged.

const OAUTH_TOKEN_URL = "https://my.hidrive.com/oauth2/token";
const REST_BASE = "https://api.hidrive.strato.com/2.1";

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let cachedToken: CachedToken | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Absolute HiDrive path for a stored (WebDAV-base-relative) hidrive_original_path. */
export function toHidriveAbsolutePath(relPath: string): string {
  const prefix = requireEnv("HIDRIVE_REST_PATH_PREFIX").replace(/\/+$/, "");
  const clean = relPath.replace(/^\/+/, "");
  return `${prefix}/${clean}`;
}

/** Get a valid access token, refreshing via the refresh-token grant and caching in memory. */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: requireEnv("HIDRIVE_CLIENT_ID"),
    client_secret: requireEnv("HIDRIVE_CLIENT_SECRET"),
    refresh_token: requireEnv("HIDRIVE_REFRESH_TOKEN"),
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`HiDrive OAuth token refresh failed (${res.status}).`);
  }
  const token = (await res.json()) as TokenResponse;
  cachedToken = {
    accessToken: token.access_token,
    expiresAt: now + token.expires_in * 1000,
  };
  return token.access_token;
}

async function hidriveFetch(
  path: string,
  init: { method: string; body?: URLSearchParams },
): Promise<Record<string, unknown>> {
  const accessToken = await getAccessToken();
  const res = await fetch(`${REST_BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: init.body ?? null,
  });
  if (!res.ok) {
    throw new Error(`HiDrive REST ${init.method} ${path} failed (${res.status}).`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export interface Sharelink {
  url: string;
  expires_at: string;
}

/** Create a TIME-LIMITED sharelink for a single absolute HiDrive path. */
export async function createSharelink(absolutePath: string, ttlSeconds: number): Promise<Sharelink> {
  const data = await hidriveFetch("/sharelink", {
    method: "POST",
    body: new URLSearchParams({ path: absolutePath, ttl: String(ttlSeconds) }),
  });
  const url = (data["uri"] as string) ?? `https://my.hidrive.com/lnk/${data["id"] as string}`;
  return { url, expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString() };
}

/**
 * Zip multiple absolute HiDrive paths server-side into a single archive, then return a
 * time-limited sharelink to that archive. No bytes stream through this process.
 */
export async function createZipSharelink(
  absolutePaths: string[],
  ttlSeconds: number,
): Promise<Sharelink & { count: number }> {
  const prefix = requireEnv("HIDRIVE_REST_PATH_PREFIX").replace(/\/+$/, "");
  const archiveDir = (process.env["HIDRIVE_ARCHIVE_DIR"] ?? `${prefix}/.sideline-archives`).replace(
    /\/+$/,
    "",
  );
  const dst = `${archiveDir}/sideline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`;

  const body = new URLSearchParams();
  body.set("dst", dst);
  body.set("base", prefix); // archive entries are stored relative to the user root
  body.set("on_exist", "autoname");
  for (const p of absolutePaths) body.append("src", p);

  await hidriveFetch("/file/archive/deflate", { method: "POST", body });

  const link = await createSharelink(dst, ttlSeconds);
  return { ...link, count: absolutePaths.length };
}
