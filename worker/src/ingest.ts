// The ingest routine: one HiDrive master JPEG -> parsed row + two preview derivatives.
// Runs on the VPS (Node) because it needs sharp (native libvips) and, ideally, exiftool.
// Idempotent: re-running on the same hidrive_original_path updates the existing row and
// overwrites its storage objects rather than creating duplicates.

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { fetchFileBytes } from "./hidrive-webdav.js";
import { parseMetadata, type PhotoMetadata } from "./metadata.js";
import { supabase, assertOk } from "./supabase.js";
import { env } from "./env.js";

const LONG_EDGE = 1600;
const PRIVATE_BUCKET = "private-previews";
const PUBLIC_BUCKET = "public-previews";

export interface IngestArgs {
  /** Path relative to HIDRIVE_WEBDAV_URL, e.g. "ingest/NGU_20250914_0001.jpg". */
  hidrivePath: string;
  /** Optional event to attach the photo to (and whose photo_count is recomputed). */
  eventId?: string | null;
}

export interface IngestResult {
  photoId: string;
  hidrivePath: string;
  width: number;
  height: number;
  persons: number;
  status: "done";
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build an SVG overlay the size of the resized image: a horizontal grey band
 * (rgba(128,128,128,0.4)) whose height is 20% of the image height, with its TOP edge at
 * 66.6% of the image height, and centred white copyright text.
 */
function buildWatermarkSvg(imgW: number, imgH: number, brand: string): string {
  const bandHeight = Math.round(imgH * 0.2);
  const bandTop = Math.round(imgH * 0.666);
  const fontSize = Math.max(12, Math.round(bandHeight * 0.26));
  const centerY = bandTop + bandHeight / 2;
  const text = escapeXml(`© ${brand} / SPORTS PHOTOGRAPHY — DISPLAY ONLY`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${imgH}" viewBox="0 0 ${imgW} ${imgH}">
  <rect x="0" y="${bandTop}" width="${imgW}" height="${bandHeight}" fill="rgba(128,128,128,0.4)"/>
  <text x="${imgW / 2}" y="${centerY}" fill="#ffffff" font-family="sans-serif" font-weight="600"
    font-size="${fontSize}" text-anchor="middle" dominant-baseline="central"
    letter-spacing="1">${text}</text>
</svg>`;
}

/** Find an athlete by case-insensitive full name, or create one. Returns the athlete id. */
async function upsertAthlete(person: { full_name: string; jersey_number: string | null }): Promise<string> {
  const { data: found, error: selErr } = await supabase
    .from("athletes")
    .select("id, jersey_number")
    .ilike("full_name", person.full_name)
    .maybeSingle();
  assertOk(selErr, "athlete lookup");

  if (found) {
    // Backfill a jersey number if we now have one and the row lacks it.
    if (person.jersey_number && !found.jersey_number) {
      const { error } = await supabase
        .from("athletes")
        .update({ jersey_number: person.jersey_number })
        .eq("id", found.id);
      assertOk(error, "athlete jersey backfill");
    }
    return found.id;
  }

  const { data: inserted, error: insErr } = await supabase
    .from("athletes")
    .insert({ full_name: person.full_name, jersey_number: person.jersey_number })
    .select("id")
    .single();
  assertOk(insErr, "athlete insert");
  return inserted!.id;
}

export async function ingestPhoto(args: IngestArgs): Promise<IngestResult> {
  const { hidrivePath } = args;
  const eventId = args.eventId ?? null;

  // 1. Fetch the master and validate it is a JPEG (sharp cannot read RAW CR3/NEF).
  const buffer = await fetchFileBytes(hidrivePath);
  let format: string | undefined;
  let trueWidth: number | undefined;
  let trueHeight: number | undefined;
  try {
    const meta = await sharp(buffer).metadata();
    format = meta.format;
    trueWidth = meta.width;
    trueHeight = meta.height;
  } catch {
    throw new Error(
      `Could not decode ${hidrivePath} as an image — masters must be JPEG (RAW formats like CR3/NEF are not supported).`,
    );
  }
  if (format !== "jpeg") {
    throw new Error(
      `Unsupported format '${format ?? "unknown"}' for ${hidrivePath}; masters must be JPEG (RAW like CR3/NEF is not supported).`,
    );
  }
  if (!trueWidth || !trueHeight) {
    throw new Error(`Could not read pixel dimensions for ${hidrivePath}.`);
  }

  // 2. Parse metadata (exiftool primary, exifr fallback).
  const metadata: PhotoMetadata = await parseMetadata(buffer);

  // 3. Resolve a stable photo id (reuse the existing row's id when re-ingesting).
  const { data: existing, error: findErr } = await supabase
    .from("photos")
    .select("id")
    .eq("hidrive_original_path", hidrivePath)
    .maybeSingle();
  assertOk(findErr, "photo lookup");
  const photoId = existing?.id ?? randomUUID();

  // 4. Build the two ~1600px long-edge derivatives.
  const baseBuffer = await sharp(buffer)
    .rotate() // auto-orient per EXIF before resizing
    .resize(LONG_EDGE, LONG_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  const baseMeta = await sharp(baseBuffer).metadata();
  const rw = baseMeta.width ?? LONG_EDGE;
  const rh = baseMeta.height ?? LONG_EDGE;

  const cleanBuffer = baseBuffer;
  const watermarkSvg = buildWatermarkSvg(rw, rh, env.BRAND);
  const watermarkedBuffer = await sharp(baseBuffer)
    .composite([{ input: Buffer.from(watermarkSvg), top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();

  // 5. Upload derivatives (overwrite on re-ingest).
  const cleanKey = `${photoId}/clean.jpg`;
  const watermarkedKey = `${photoId}/watermarked.jpg`;

  const cleanUpload = await supabase.storage
    .from(PRIVATE_BUCKET)
    .upload(cleanKey, cleanBuffer, { contentType: "image/jpeg", upsert: true });
  assertOk(cleanUpload.error, "clean upload");

  const wmUpload = await supabase.storage
    .from(PUBLIC_BUCKET)
    .upload(watermarkedKey, watermarkedBuffer, { contentType: "image/jpeg", upsert: true });
  assertOk(wmUpload.error, "watermarked upload");

  const publicUrl = supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(watermarkedKey).data.publicUrl;

  // 6. Upsert athletes and collect their ids.
  const athleteIds: string[] = [];
  for (const person of metadata.persons) {
    athleteIds.push(await upsertAthlete(person));
  }

  // 7. Upsert the photo row.
  //   clean_preview_url stores the in-bucket key (private bucket -> signed at read time);
  //   public_watermarked_url stores the world-readable public URL.
  const { error: photoErr } = await supabase.from("photos").upsert(
    {
      id: photoId,
      event_id: eventId,
      hidrive_original_path: hidrivePath,
      public_watermarked_url: publicUrl,
      clean_preview_url: cleanKey,
      headline: metadata.headline,
      caption: metadata.caption,
      date_taken: metadata.date_taken,
      width: trueWidth,
      height: trueHeight,
      exif_data: metadata.exif,
      ingest_status: "done",
      processed_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  assertOk(photoErr, "photo upsert");

  // 8. Rebuild the photo <-> athlete links (idempotent).
  const { error: delErr } = await supabase.from("photo_athletes").delete().eq("photo_id", photoId);
  assertOk(delErr, "photo_athletes clear");
  if (athleteIds.length) {
    const { error: linkErr } = await supabase
      .from("photo_athletes")
      .insert(athleteIds.map((athlete_id) => ({ photo_id: photoId, athlete_id })));
    assertOk(linkErr, "photo_athletes insert");
  }

  // 9. Recompute the event's photo_count from done photos (no fragile increment).
  if (eventId) {
    const { count, error: countErr } = await supabase
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("ingest_status", "done");
    assertOk(countErr, "photo_count recount");
    const { error: updErr } = await supabase
      .from("events")
      .update({ photo_count: count ?? 0 })
      .eq("id", eventId);
    assertOk(updErr, "event photo_count update");
  }

  return {
    photoId,
    hidrivePath,
    width: trueWidth,
    height: trueHeight,
    persons: metadata.persons.length,
    status: "done",
  };
}
