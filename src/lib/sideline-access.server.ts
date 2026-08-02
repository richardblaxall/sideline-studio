// Server-only helpers for private gallery access tokens.
import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_SECONDS = 60 * 30; // short-lived

function signingKey(): string {
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) throw new Error("Access signing key unavailable");
  return key;
}

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

/** Mints a short-lived access JWT-style token scoped to one event. */
export function mintAccessToken(eventId: string): { token: string; expiresAt: string } {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ sub: eventId, scope: "gallery", exp }));
  const payload = `${header}.${body}`;
  return {
    token: `${payload}.${sign(payload)}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/** Verifies a token and returns the event id it grants access to. */
export function verifyAccessToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = sign(payload);
  const a = Buffer.from(parts[2]!);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as {
      sub?: string;
      exp?: number;
    };
    if (!claims.sub || !claims.exp) return null;
    if (claims.exp * 1000 < Date.now()) return null;
    return claims.sub;
  } catch {
    return null;
  }
}

/** Constant-time compare for passcodes / access tokens stored on event_access. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
