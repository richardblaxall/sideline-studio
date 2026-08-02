// HTTP client to the app's ingest API.
//
// The worker no longer holds Supabase credentials: Lovable Cloud never exposes the service-role
// key or database URL outside the app runtime. Instead the worker does all the heavy image work
// and hands the finished result to the app, which performs every Supabase write. This module is
// the transport for that hand-off. Uses global fetch (no dependencies).

import { env } from "./env.js";

export interface ReceivePayload {
  hidrive_path: string;
  event_id: string | null;
  metadata: {
    headline: string | null;
    caption: string | null;
    date_taken: string | null;
    width: number;
    height: number;
    exif_data: Record<string, unknown>;
    persons: { full_name: string; jersey_number: string | null }[];
  };
  clean_jpeg_base64: string;
  watermarked_jpeg_base64: string;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${env.APP_INGEST_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Machine-to-machine shared secret (must match the app's INGEST_RECEIVE_SECRET).
      "x-ingest-secret": env.INGEST_RECEIVE_SECRET,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `POST ${path} -> ${res.status} ${res.statusText}: ${text.slice(0, 500) || "(empty body)"}`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`POST ${path} returned non-JSON response: ${text.slice(0, 200)}`);
  }
}

/** Hand a fully-processed photo to the app. Returns the app-assigned photo id. */
export async function postReceive(payload: ReceivePayload): Promise<{ ok: true; photo_id: string }> {
  return postJson("/api/ingest/receive", payload);
}

/** Ask the app which candidate paths are not already fully ingested. */
export async function postCheck(paths: string[]): Promise<string[]> {
  const { new_paths } = await postJson<{ new_paths: string[] }>("/api/ingest/check", { paths });
  return new_paths;
}
