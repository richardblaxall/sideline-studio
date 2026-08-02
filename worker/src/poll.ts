// Poller: list the HiDrive ingest folder over WebDAV and ingest any files we haven't already
// processed. HiDrive has no webhooks, so this is cron-driven (and/or triggered over HTTP by
// Make.com). Kept light — it only enumerates + dedupes; all heavy work stays in ingestPhoto.

import { listFolder } from "./hidrive-webdav.js";
import { ingestPhoto } from "./ingest.js";
import { supabase, assertOk } from "./supabase.js";
import { env } from "./env.js";

const JPEG_EXT = /\.jpe?g$/i;

export interface PollResult {
  scanned: number;
  newFiles: number;
  skipped: number;
  ingested: string[];
  failed: { path: string; error: string }[];
}

export async function pollIngestFolder(eventId?: string | null): Promise<PollResult> {
  const files = await listFolder(env.HIDRIVE_INGEST_FOLDER);
  const candidates = files.filter((f) => JPEG_EXT.test(f.name));

  // Dedupe against masters we've already fully ingested.
  const done = new Set<string>();
  const paths = candidates.map((c) => c.path);
  if (paths.length) {
    const { data, error } = await supabase
      .from("photos")
      .select("hidrive_original_path")
      .in("hidrive_original_path", paths)
      .eq("ingest_status", "done");
    assertOk(error, "poll dedupe query");
    for (const row of data ?? []) {
      if (row.hidrive_original_path) done.add(row.hidrive_original_path);
    }
  }

  const fresh = candidates.filter((c) => !done.has(c.path));
  const ingested: string[] = [];
  const failed: { path: string; error: string }[] = [];

  for (const file of fresh) {
    try {
      const result = await ingestPhoto({ hidrivePath: file.path, eventId });
      ingested.push(result.photoId);
    } catch (err) {
      const message = (err as Error).message;
      failed.push({ path: file.path, error: message });
      console.error(`[poll] ingest failed for ${file.path}: ${message}`);
    }
  }

  return {
    scanned: candidates.length,
    newFiles: fresh.length,
    skipped: candidates.length - fresh.length,
    ingested,
    failed,
  };
}
