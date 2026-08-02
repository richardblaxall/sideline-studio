// Poller: list the HiDrive ingest folder over WebDAV and ingest any files we haven't already
// processed. HiDrive has no webhooks, so this is cron-driven (and/or triggered over HTTP by
// Make.com). Kept light — it only enumerates + dedupes; all heavy work stays in ingestPhoto.

import { listFolder } from "./hidrive-webdav.js";
import { ingestPhoto } from "./ingest.js";
import { postCheck } from "./app-client.js";
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

  // Ask the app which candidates are not already fully ingested — the worker has no direct DB
  // access, so /api/ingest/check does the dedupe against ingest_status='done'.
  let freshPaths = new Set<string>();
  if (candidates.length) {
    const newPaths = await postCheck(candidates.map((c) => c.path));
    freshPaths = new Set(newPaths);
  }

  const fresh = candidates.filter((c) => freshPaths.has(c.path));
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
