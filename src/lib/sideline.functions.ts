// Server functions backing the client-download flow.
// Client access is account-based and invite-only: users sign in with email +
// password, and downloads unlock only once their email is on the invite list
// and approved.
//
// NOTE ON RUNTIME SPLIT: ingest (HiDrive WebDAV read, metadata parsing, sharp derivatives)
// lives in the standalone VPS worker under /worker — it needs native deps that cannot run on
// the Cloudflare Workers app runtime. These in-app functions are pure JS: they only read from
// Supabase and mint HiDrive REST sharelinks. Do NOT add sharp/exifr here.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Sharelink / signed-URL lifetimes.
const SINGLE_DOWNLOAD_TTL_SECONDS = 15 * 60;
const BATCH_DOWNLOAD_TTL_SECONDS = 30 * 60;
const CLEAN_PREVIEW_TTL_SECONDS = 60 * 60;
const BATCH_CAP = 100;
const PRIVATE_BUCKET = "private-previews";

/** Returns whether the signed-in user is an approved client. */
export const getAccessStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { isApprovedClient } = await import("./sideline-access.server");
    const approved = await isApprovedClient(context.userId);
    return { approved, status: approved ? ("approved" as const) : ("pending" as const) };
  });

const cleanPreviewsInput = z.object({
  event_id: z.string().uuid(),
});

/**
 * Returns clean (un-watermarked) preview URLs for one event to approved clients.
 *
 * clean_preview_url stores an in-bucket key in the PRIVATE `private-previews` bucket, so we
 * mint a short-lived signed URL per photo at read time. (Legacy/demo rows that stored a plain
 * public path are passed through unchanged.)
 *
 * PHASE-2 SEAM: single-club today, so the gate is the global isApprovedClient. When we move to
 * per-event grants, replace this with isApprovedClientForEvent(userId, event_id) backed by a
 * future client_event_grants table — the rest of this handler stays the same.
 */
export const getCleanPreviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => cleanPreviewsInput.parse(data))
  .handler(async ({ data, context }) => {
    const { isApprovedClient } = await import("./sideline-access.server");
    if (!(await isApprovedClient(context.userId))) {
      return { ok: false as const, previews: {} as Record<string, string> };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("photos")
      .select("id, clean_preview_url")
      .eq("event_id", data.event_id);

    const previews: Record<string, string> = {};
    const toSign: { id: string; key: string }[] = [];
    for (const row of rows ?? []) {
      const value = row.clean_preview_url;
      if (!value) continue;
      // Pass through already-usable URLs (legacy/demo rows); sign private-bucket keys.
      if (value.startsWith("http") || value.startsWith("/")) {
        previews[row.id] = value;
      } else {
        toSign.push({ id: row.id, key: value });
      }
    }

    if (toSign.length) {
      const { data: signed } = await supabaseAdmin.storage
        .from(PRIVATE_BUCKET)
        .createSignedUrls(
          toSign.map((t) => t.key),
          CLEAN_PREVIEW_TTL_SECONDS,
        );
      const byKey = new Map((signed ?? []).map((s) => [s.path, s.signedUrl] as const));
      for (const { id, key } of toSign) {
        const url = byKey.get(key);
        if (url) previews[id] = url;
      }
    }

    return { ok: true as const, previews };
  });

const downloadInput = z
  .object({
    photo_id: z.string().uuid().optional(),
    photo_ids: z.array(z.string().uuid()).min(1).max(BATCH_CAP).optional(),
  })
  .refine((d) => Boolean(d.photo_id) !== Boolean(d.photo_ids && d.photo_ids.length), {
    message: "Provide exactly one of photo_id or photo_ids",
  });

/**
 * Returns a TIME-LIMITED HiDrive sharelink to the master original(s) for approved clients.
 *   { photo_id }    -> one sharelink to that master.
 *   { photo_ids[] } -> one sharelink to a server-side ZIP of those masters (capped).
 * The master's HiDrive path and any non-expiring URL are NEVER returned to the client, and no
 * master bytes stream through this function (HiDrive builds the archive and serves the link).
 *
 * PHASE-2 SEAM: single-club today, so the gate is the global isApprovedClient. When we move to
 * per-event grants, replace this check with isApprovedClientForEvent(userId, event_id of each
 * photo) backed by a future client_event_grants table.
 */
export const downloadOriginal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => downloadInput.parse(data))
  .handler(async ({ data, context }) => {
    const { isApprovedClient } = await import("./sideline-access.server");
    if (!(await isApprovedClient(context.userId))) {
      return { ok: false as const, reason: "unauthorized" as const };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createSharelink, createZipSharelink, toHidriveAbsolutePath } = await import(
      "./hidrive-rest.server"
    );

    // Batch: zip the selected masters and return a single sharelink.
    if (data.photo_ids && data.photo_ids.length) {
      const ids = data.photo_ids.slice(0, BATCH_CAP);
      const { data: photos } = await supabaseAdmin
        .from("photos")
        .select("id, hidrive_original_path")
        .in("id", ids);

      const paths = (photos ?? [])
        .map((p) => p.hidrive_original_path)
        .filter((p): p is string => Boolean(p))
        .map(toHidriveAbsolutePath);

      if (!paths.length) return { ok: false as const, reason: "not_found" as const };

      const link = await createZipSharelink(paths, BATCH_DOWNLOAD_TTL_SECONDS);
      return { ok: true as const, url: link.url, expires_at: link.expires_at, count: link.count };
    }

    // Single master.
    const { data: photo } = await supabaseAdmin
      .from("photos")
      .select("id, hidrive_original_path")
      .eq("id", data.photo_id!)
      .maybeSingle();

    if (!photo?.hidrive_original_path) {
      return { ok: false as const, reason: "not_found" as const };
    }

    const link = await createSharelink(
      toHidriveAbsolutePath(photo.hidrive_original_path),
      SINGLE_DOWNLOAD_TTL_SECONDS,
    );
    return { ok: true as const, url: link.url, expires_at: link.expires_at };
  });
