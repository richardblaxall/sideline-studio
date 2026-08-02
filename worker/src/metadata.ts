// Metadata extraction for master JPEGs.
//
// Primary path: exiftool (installed on the VPS) via child_process — the most reliable reader
// of XMP structured tags, especially Iptc4xmpExt:PersonInImage ("Persons Shown").
// Fallback path: exifr (pure Node) when exiftool is not present.
//
// We deliberately read PersonInImage from XMP (Iptc4xmpExt), NOT the legacy IIM IPTC
// keyword/byline fields — those are empty in this workflow.

import { spawn } from "node:child_process";
import exifr from "exifr";

export interface PersonShown {
  full_name: string;
  jersey_number: string | null;
}

export interface ExifData {
  shutter: string | null;
  iso: string | null;
  focal_length: string | null;
  aperture: string | null;
  camera_model: string | null;
  lens: string | null;
}

export interface PhotoMetadata {
  exif: ExifData;
  headline: string | null;
  caption: string | null;
  /** Naive local timestamp "YYYY-MM-DDTHH:MM:SS" (stored into photos.date_taken). */
  date_taken: string | null;
  persons: PersonShown[];
}

/** Split a trailing jersey number, e.g. "Marcus Elwood #9" -> { full_name, jersey_number }. */
export function splitPerson(raw: string): PersonShown {
  const name = raw.trim();
  const m = name.match(/^(.*?)\s*#\s*(\d+)\s*$/);
  if (m) return { full_name: m[1]!.trim(), jersey_number: m[2]! };
  return { full_name: name, jersey_number: null };
}

function normalizeShutter(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1) return `${n}s`;
  return `1/${Math.round(1 / n)}`;
}

function normalizeFocal(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const num = s.match(/[\d.]+/)?.[0];
  return num ? `${Math.round(Number(num))}mm` : s;
}

function normalizeAperture(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^f\//i.test(s)) return s;
  const num = s.match(/[\d.]+/)?.[0];
  return num ? `f/${num}` : s;
}

function str(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function normalizeExifToolDate(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  // exiftool: "2025:09:14 15:12:04" (optionally with subsec/offset) -> "2025-09-14T15:12:04"
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  return s;
}

function toPersons(value: unknown): PersonShown[] {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : String(value).split(/\s*[;,]\s*/);
  return list
    .map((v) => String(v).trim())
    .filter(Boolean)
    .map(splitPerson);
}

// --- exiftool (primary) ------------------------------------------------------------------

let exiftoolChecked = false;
let exiftoolAvailable = false;

async function hasExiftool(): Promise<boolean> {
  if (exiftoolChecked) return exiftoolAvailable;
  exiftoolChecked = true;
  exiftoolAvailable = await new Promise<boolean>((resolve) => {
    const child = spawn("exiftool", ["-ver"]);
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
  return exiftoolAvailable;
}

/**
 * Parse metadata using the exiftool binary, reading the JPEG from stdin.
 * This is the primary, most reliable path for XMP structured tags.
 * Throws if exiftool is unavailable or returns no data.
 */
export async function parseMetadataViaExiftool(buffer: Buffer): Promise<PhotoMetadata> {
  if (!(await hasExiftool())) {
    throw new Error("exiftool not available");
  }

  const args = [
    "-json",
    "-charset",
    "utf8",
    // XMP-first descriptive fields
    "-XMP-iptcExt:PersonInImage",
    "-XMP-photoshop:Headline",
    "-XMP-dc:Description",
    "-Headline",
    "-Description",
    // EXIF
    "-ExposureTime",
    "-ISO",
    "-FocalLength",
    "-FNumber",
    "-Model",
    "-LensModel",
    "-DateTimeOriginal",
    "-", // read image from stdin
  ];

  const json = await new Promise<string>((resolve, reject) => {
    const child = spawn("exiftool", args);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`exiftool exited ${code}: ${err.slice(0, 200)}`));
    });
    child.stdin.write(buffer);
    child.stdin.end();
  });

  const parsed = JSON.parse(json) as Array<Record<string, unknown>>;
  const tags = parsed[0] ?? {};

  return {
    exif: {
      shutter: normalizeShutter(tags["ExposureTime"]),
      iso: str(tags["ISO"]),
      focal_length: normalizeFocal(tags["FocalLength"]),
      aperture: normalizeAperture(tags["FNumber"]),
      camera_model: str(tags["Model"]),
      lens: str(tags["LensModel"]),
    },
    headline: str(tags["Headline"]),
    caption: str(tags["Description"]),
    date_taken: normalizeExifToolDate(tags["DateTimeOriginal"]),
    persons: toPersons(tags["PersonInImage"]),
  };
}

// --- exifr (fallback) --------------------------------------------------------------------

/** Parse metadata using exifr (pure Node). Fallback when exiftool is unavailable. */
export async function parseMetadataViaExifr(buffer: Buffer): Promise<PhotoMetadata> {
  const data =
    (await exifr.parse(buffer, {
      xmp: true,
      iptc: false,
      exif: true,
      tiff: true,
      mergeOutput: true,
    })) ?? {};

  const dateRaw = data.DateTimeOriginal ?? data.CreateDate;
  let date_taken: string | null = null;
  if (dateRaw instanceof Date && !Number.isNaN(dateRaw.getTime())) {
    // Keep the naive wall-clock reading (strip the trailing Z / ms).
    date_taken = dateRaw.toISOString().replace(/\.\d+Z$/, "").replace(/Z$/, "");
  } else if (dateRaw) {
    date_taken = normalizeExifToolDate(dateRaw);
  }

  return {
    exif: {
      shutter: normalizeShutter(data.ExposureTime),
      iso: str(data.ISO ?? data.ISOSpeedRatings),
      focal_length: normalizeFocal(data.FocalLength),
      aperture: normalizeAperture(data.FNumber),
      camera_model: str(data.Model),
      lens: str(data.LensModel ?? data.Lens),
    },
    headline: str(data.Headline),
    caption: str(data.description ?? data.Description ?? data.ImageDescription),
    date_taken,
    // exifr surfaces XMP Iptc4xmpExt:PersonInImage as PersonInImage.
    persons: toPersons(data.PersonInImage),
  };
}

/**
 * Parse a JPEG buffer's metadata. Prefers exiftool (reliable XMP structured tags);
 * transparently falls back to exifr when exiftool is not installed or errors.
 */
export async function parseMetadata(buffer: Buffer): Promise<PhotoMetadata> {
  if (await hasExiftool()) {
    try {
      return await parseMetadataViaExiftool(buffer);
    } catch (err) {
      console.warn(`[metadata] exiftool failed, falling back to exifr: ${(err as Error).message}`);
    }
  }
  return parseMetadataViaExifr(buffer);
}
