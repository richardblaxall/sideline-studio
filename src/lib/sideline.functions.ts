// Server functions backing the private-gallery flow.
// These are the app-internal equivalents of the planned
// `verify-access`, `download-original` and `ingest-photo` endpoints.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const verifyAccessInput = z.object({
  event_id: z.string().uuid(),
  passcode: z.string().min(1).max(200).optional(),
  token: z.string().min(1).max(500).optional(),
});

/** POST {event_id, passcode | token} -> short-lived access token for that event. */
export const verifyAccess = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => verifyAccessInput.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { mintAccessToken, safeEqual } = await import("./sideline-access.server");

    const { data: rows, error } = await supabaseAdmin
      .from("event_access")
      .select("passcode_hash, access_token, expires_at")
      .eq("event_id", data.event_id);

    if (error) return { ok: false as const, reason: "unavailable" as const };

    const now = Date.now();
    const match = (rows ?? []).find((row) => {
      if (row.expires_at && new Date(row.expires_at).getTime() < now) return false;
      if (data.token && row.access_token) return safeEqual(data.token, row.access_token);
      if (data.passcode && row.passcode_hash?.startsWith("demo:")) {
        return safeEqual(data.passcode, row.passcode_hash.slice(5));
      }
      return false;
    });

    if (!match) return { ok: false as const, reason: "invalid" as const };

    const minted = mintAccessToken(data.event_id);
    return { ok: true as const, ...minted };
  });

const cleanPreviewsInput = z.object({
  event_id: z.string().uuid(),
  access_token: z.string().min(1).max(2000),
});

/** Returns RLS-gated clean (un-watermarked) preview URLs for an unlocked event. */
export const getCleanPreviews = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => cleanPreviewsInput.parse(data))
  .handler(async ({ data }) => {
    const { verifyAccessToken } = await import("./sideline-access.server");
    const eventId = verifyAccessToken(data.access_token);
    if (!eventId || eventId !== data.event_id) {
      return { ok: false as const, previews: {} as Record<string, string> };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("photos")
      .select("id, clean_preview_url")
      .eq("event_id", eventId);

    const previews: Record<string, string> = {};
    for (const row of rows ?? []) {
      if (row.clean_preview_url) previews[row.id] = row.clean_preview_url;
    }
    return { ok: true as const, previews };
  });

const downloadInput = z.object({
  photo_id: z.string().uuid(),
  access_token: z.string().min(1).max(2000),
});

/** POST {photo_id} + access token -> time-limited download URL for the master file. */
export const downloadOriginal = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => downloadInput.parse(data))
  .handler(async ({ data }) => {
    const { verifyAccessToken } = await import("./sideline-access.server");
    const eventId = verifyAccessToken(data.access_token);
    if (!eventId) return { ok: false as const, reason: "unauthorized" as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: photo } = await supabaseAdmin
      .from("photos")
      .select("id, event_id, clean_preview_url, hidrive_original_path")
      .eq("id", data.photo_id)
      .maybeSingle();

    if (!photo || photo.event_id !== eventId) {
      return { ok: false as const, reason: "unauthorized" as const };
    }

    // Master-file delivery is wired up later; the clean preview stands in for now
    // and the master path is never returned to the client.
    return {
      ok: true as const,
      url: photo.clean_preview_url ?? "",
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
  });

/** POST {hidrive_path} -> placeholder: IPTC/EXIF parsing + preview building lands later. */
export const ingestPhoto = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ hidrive_path: z.string().min(1).max(1000) }).parse(data),
  )
  .handler(async ({ data }) => {
    return { ok: true as const, queued: data.hidrive_path, ingest_status: "pending" as const };
  });
