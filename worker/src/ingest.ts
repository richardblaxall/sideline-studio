// The ingest routine: one HiDrive master JPEG -> parsed metadata + two preview derivatives.
// Runs on the VPS (Node) because it needs sharp (native libvips) and, ideally, exiftool.
//
// The worker no longer writes to Supabase directly (Lovable Cloud does not expose the
// service-role key / database URL to it). Instead the finished derivatives + metadata are POSTed
// to the app's /api/ingest/receive, which performs all Supabase writes. Idempotency (re-running
// on the same hidrive_original_path updates the existing row, no duplicates) is enforced app-side.

import sharp from "sharp";
import { fetchFileBytes } from "./hidrive-webdav.js";
import { parseMetadata, type PhotoMetadata } from "./metadata.js";
import { postReceive } from "./app-client.js";
import { env } from "./env.js";

const LONG_EDGE = 1600;

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
 * (rgba(128,128,128,0.4)) anchored to the BOTTOM of the image (bottom edge flush,
 * small margin), with centred white "© <brand>" copyright text.
 *
 * The band height tracks the SHORTER edge (≈13%), so it reads as a consistent visual
 * thickness on both portrait and landscape frames and never crosses the centre of the
 * subject. The font size is auto-fitted so the full string fits within the image width
 * with padding on both sides — the text can never run off either edge.
 */
function buildWatermarkSvg(imgW: number, imgH: number, brand: string): string {
  const word = brand.trim() || "Photerior";
  const label = `© ${word}`;
  const text = escapeXml(label);

  // Band sizing keyed off the shorter edge for orientation-independent thickness.
  const shortEdge = Math.min(imgW, imgH);
  const bandHeight = Math.round(shortEdge * 0.13);
  // Flush to the bottom with a small breathing margin (~1% of the short edge).
  const margin = Math.round(shortEdge * 0.01);
  const bandTop = imgH - bandHeight - margin;
  const centerY = bandTop + bandHeight / 2;

  // Auto-fit the font so the whole string fits within the width with side padding.
  // Estimate advance width per glyph relative to the font size (sans-serif ≈ 0.6em avg),
  // plus proportional letter-spacing, then solve for the largest size that fits.
  const sidePadding = Math.round(imgW * 0.06); // 6% padding each side
  const usableWidth = Math.max(1, imgW - 2 * sidePadding);
  const charFactor = 0.6;
  const letterSpacingFactor = 0.05;
  const n = Math.max(1, label.length);
  const advancePerSize = charFactor * n + letterSpacingFactor * Math.max(0, n - 1);
  const fitFontSize = usableWidth / advancePerSize;
  const bandCap = bandHeight * 0.5; // keep the text comfortably inside the band
  const fontSize = Math.max(12, Math.floor(Math.min(fitFontSize, bandCap)));
  const letterSpacing = (fontSize * letterSpacingFactor).toFixed(2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${imgH}" viewBox="0 0 ${imgW} ${imgH}">
  <rect x="0" y="${bandTop}" width="${imgW}" height="${bandHeight}" fill="rgba(128,128,128,0.4)"/>
  <text x="${imgW / 2}" y="${centerY}" fill="#ffffff" font-family="sans-serif" font-weight="600"
    font-size="${fontSize}" text-anchor="middle" dominant-baseline="central"
    letter-spacing="${letterSpacing}">${text}</text>
</svg>`;
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

  // 3. Build the two ~1600px long-edge derivatives.
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

  // 4. Hand the finished work to the app. The app owns all Supabase writes (row upsert, storage
  //    uploads, athletes/photo_athletes, event photo_count) and assigns the stable photo id.
  //    Two ~1600px JPEGs base64 (~1MB total) is well within request limits.
  const { photo_id } = await postReceive({
    hidrive_path: hidrivePath,
    event_id: eventId,
    metadata: {
      headline: metadata.headline,
      caption: metadata.caption,
      date_taken: metadata.date_taken,
      width: trueWidth,
      height: trueHeight,
      // ExifData is a fixed-key object; widen it to the transport's generic jsonb shape.
      exif_data: metadata.exif as unknown as Record<string, unknown>,
      persons: metadata.persons,
    },
    clean_jpeg_base64: cleanBuffer.toString("base64"),
    watermarked_jpeg_base64: watermarkedBuffer.toString("base64"),
  });

  return {
    photoId: photo_id,
    hidrivePath,
    width: trueWidth,
    height: trueHeight,
    persons: metadata.persons.length,
    status: "done",
  };
}
