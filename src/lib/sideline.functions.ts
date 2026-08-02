// Server functions backing the client-download flow.
// Client access is account-based and invite-only: users sign in with email +
// password, and downloads unlock only once their email is on the invite list
// and approved.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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

/** Returns clean (un-watermarked) preview URLs for one event to approved clients. */
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
    for (const row of rows ?? []) {
      if (row.clean_preview_url) previews[row.id] = row.clean_preview_url;
    }
    return { ok: true as const, previews };
  });

const downloadInput = z.object({
  photo_id: z.string().uuid(),
});

/** POST {photo_id} -> time-limited download URL for the master file. */
export const downloadOriginal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => downloadInput.parse(data))
  .handler(async ({ data, context }) => {
    const { isApprovedClient } = await import("./sideline-access.server");
    if (!(await isApprovedClient(context.userId))) {
      return { ok: false as const, reason: "unauthorized" as const };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: photo } = await supabaseAdmin
      .from("photos")
      .select("id, clean_preview_url, hidrive_original_path")
      .eq("id", data.photo_id)
      .maybeSingle();

    if (!photo) return { ok: false as const, reason: "unauthorized" as const };

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
