// Server-only ingest logic for the machine-to-machine ingest API (/api/ingest/*).
//
// WHY THIS EXISTS: Lovable Cloud never exposes SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY outside
// the app's own server runtime, so the VPS worker in /worker cannot write to Supabase directly.
// Instead the worker does all the heavy image work (HiDrive read, exif parse, sharp derivatives)
// and POSTs the finished JPEGs + metadata here; this module — running with the injected
// service-role admin client — performs every Supabase write.
//
// These endpoints are NOT tied to Supabase user auth. They are gated by a shared secret
// (INGEST_RECEIVE_SECRET) compared in constant time. This file is `.server.ts` so it (and the
// supabase-js dependency it pulls in) never ships to the client bundle; route files import it
// dynamically inside their handlers.
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";

const PRIVATE_BUCKET = "private-previews";
const PUBLIC_BUCKET = "public-previews";

// Two ~1600px JPEGs base64 (~1MB total) plus JSON overhead — 15MB is a generous, sensible cap.
export const INGEST_MAX_BODY_BYTES = 15 * 1024 * 1024;

/**
 * Constant-time comparison of the caller-supplied `x-ingest-secret` against the configured
 * INGEST_RECEIVE_SECRET. Returns false if either side is missing (the endpoint is closed until
 * the secret is set) or the lengths differ.
 */
export function verifyIngestSecret(provided: string | null | undefined): boolean {
  const expected = process.env["INGEST_RECEIVE_SECRET"];
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const personSchema = z.object({
  full_name: z.string().min(1),
  jersey_number: z.string().nullable().optional(),
});

const metadataSchema = z.object({
  headline: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  date_taken: z.string().nullable().optional(),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
  exif_data: z.record(z.string(), z.unknown()).nullable().optional(),
  persons: z.array(personSchema).default([]),
});

export const receiveSchema = z.object({
  hidrive_path: z.string().min(1),
  event_id: z.string().uuid().nullable().optional(),
  metadata: metadataSchema,
  clean_jpeg_base64: z.string().min(1),
  watermarked_jpeg_base64: z.string().min(1),
});

export const checkSchema = z.object({
  paths: z.array(z.string()),
});

export type ReceivePayload = z.infer<typeof receiveSchema>;

/**
 * Decode a base64 field and confirm it is JPEG bytes (SOI marker 0xFF 0xD8 0xFF).
 * Throws on anything that doesn't decode to a JPEG.
 */
export function decodeJpeg(base64: string): Buffer {
  const buf = Buffer.from(base64, "base64");
  if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
    throw new Error("not valid JPEG data");
  }
  return buf;
}

/** Find an athlete by case-insensitive full name, or create one. Returns the athlete id. */
async function upsertAthlete(person: {
  full_name: string;
  jersey_number: string | null;
}): Promise<string> {
  const { data: found, error: selErr } = await supabaseAdmin
    .from("athletes")
    .select("id, jersey_number")
    .ilike("full_name", person.full_name)
    .maybeSingle();
  if (selErr) throw new Error(`athlete lookup: ${selErr.message}`);

  if (found) {
    // Backfill a jersey number if we now have one and the row lacks it.
    if (person.jersey_number && !found.jersey_number) {
      const { error } = await supabaseAdmin
        .from("athletes")
        .update({ jersey_number: person.jersey_number })
        .eq("id", found.id);
      if (error) throw new Error(`athlete jersey backfill: ${error.message}`);
    }
    return found.id;
  }

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("athletes")
    .insert({ full_name: person.full_name, jersey_number: person.jersey_number })
    .select("id")
    .single();
  if (insErr) throw new Error(`athlete insert: ${insErr.message}`);
  return inserted.id;
}

/**
 * Persist one fully-processed photo: upload both derivatives, upsert the photos row (idempotent
 * per hidrive_original_path), and rebuild its athlete links. The row lands ingest_status='done'
 * but is_published=false (a DB trigger keeps events.photo_count = count of PUBLISHED photos), so
 * it stays hidden from the public gallery until explicitly published.
 */
export async function handleReceive(payload: ReceivePayload): Promise<{ photo_id: string }> {
  const { hidrive_path, metadata } = payload;
  const eventId = payload.event_id ?? null;

  const cleanBuffer = decodeJpeg(payload.clean_jpeg_base64);
  const watermarkedBuffer = decodeJpeg(payload.watermarked_jpeg_base64);

  // Resolve a stable photo id (reuse the existing row's id when re-ingesting -> idempotent).
  const { data: existing, error: findErr } = await supabaseAdmin
    .from("photos")
    .select("id")
    .eq("hidrive_original_path", hidrive_path)
    .maybeSingle();
  if (findErr) throw new Error(`photo lookup: ${findErr.message}`);
  const photoId = existing?.id ?? crypto.randomUUID();

  const cleanKey = `${photoId}/clean.jpg`;
  const watermarkedKey = `${photoId}/watermarked.jpg`;

  // Upload derivatives (overwrite on re-ingest). clean -> private bucket, watermarked -> public.
  const cleanUpload = await supabaseAdmin.storage
    .from(PRIVATE_BUCKET)
    .upload(cleanKey, cleanBuffer, { contentType: "image/jpeg", upsert: true });
  if (cleanUpload.error) throw new Error(`clean upload: ${cleanUpload.error.message}`);

  const wmUpload = await supabaseAdmin.storage
    .from(PUBLIC_BUCKET)
    .upload(watermarkedKey, watermarkedBuffer, { contentType: "image/jpeg", upsert: true });
  if (wmUpload.error) throw new Error(`watermarked upload: ${wmUpload.error.message}`);

  // public-previews stays PRIVATE (workspace guardrail), so we store the same-origin path the
  // app's public route serves, not getPublicUrl. clean_preview_url stores the in-bucket key
  // (private bucket -> signed at read time by getCleanPreviews).
  const publicUrl = `/api/public/previews/${watermarkedKey}`;

  // Upsert athletes and collect their ids.
  const athleteIds: string[] = [];
  for (const person of metadata.persons) {
    athleteIds.push(
      await upsertAthlete({
        full_name: person.full_name,
        jersey_number: person.jersey_number ?? null,
      }),
    );
  }

  // Upsert the photo row. is_published is deliberately omitted: on first insert it takes the
  // column default (false = hidden); on re-ingest the upsert only SETs the columns present here,
  // so an already-approved photo keeps its is_published=true.
  const { error: photoErr } = await supabaseAdmin.from("photos").upsert(
    {
      id: photoId,
      event_id: eventId,
      hidrive_original_path: hidrive_path,
      public_watermarked_url: publicUrl,
      clean_preview_url: cleanKey,
      headline: metadata.headline ?? null,
      caption: metadata.caption ?? null,
      date_taken: metadata.date_taken ?? null,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      exif_data: (metadata.exif_data ?? null) as Json,
      ingest_status: "done",
      processed_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (photoErr) throw new Error(`photo upsert: ${photoErr.message}`);

  // Rebuild the photo <-> athlete links (idempotent).
  const { error: delErr } = await supabaseAdmin
    .from("photo_athletes")
    .delete()
    .eq("photo_id", photoId);
  if (delErr) throw new Error(`photo_athletes clear: ${delErr.message}`);
  if (athleteIds.length) {
    const { error: linkErr } = await supabaseAdmin
      .from("photo_athletes")
      .insert(athleteIds.map((athlete_id) => ({ photo_id: photoId, athlete_id })));
    if (linkErr) throw new Error(`photo_athletes insert: ${linkErr.message}`);
  }

  // events.photo_count is maintained by the recount_event_photos trigger (counts published
  // photos only), so there is nothing to recompute here.
  return { photo_id: photoId };
}

/**
 * Given candidate HiDrive paths, return the subset that is NOT already fully ingested
 * (ingest_status='done'). Lets the poller skip already-ingested files without DB access.
 */
export async function handleCheck(paths: string[]): Promise<{ new_paths: string[] }> {
  if (!paths.length) return { new_paths: [] };

  const { data, error } = await supabaseAdmin
    .from("photos")
    .select("hidrive_original_path")
    .in("hidrive_original_path", paths)
    .eq("ingest_status", "done");
  if (error) throw new Error(`ingest check: ${error.message}`);

  const done = new Set<string>();
  for (const row of data ?? []) {
    if (row.hidrive_original_path) done.add(row.hidrive_original_path);
  }
  return { new_paths: paths.filter((p) => !done.has(p)) };
}
