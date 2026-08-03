# Sideline ingest worker

Standalone Node program that ingests master JPEGs from IONOS HiDrive and hands the finished
results to the app. It is **not** part of the Cloudflare Workers app bundle — it runs on your VPS
because it needs `sharp` (native libvips) and, ideally, the `exiftool` binary. It holds **no
Supabase credentials**: Lovable Cloud does not expose the service-role key / database URL outside
the app, so the app performs every Supabase write. See the main [`SECRETS.md`](../SECRETS.md) for
how the secrets split across the app and this worker.

## What it does

1. Reads a master JPEG from HiDrive over WebDAV.
2. Parses metadata (exiftool primary, exifr fallback): EXIF (shutter/iso/focal/aperture/
   camera/lens), `photoshop:Headline`, `dc:description`, and **Persons Shown** from XMP
   `Iptc4xmpExt:PersonInImage` (jersey numbers like `Marcus Elwood #9` are split out).
3. Builds two ~1600px long-edge derivatives with sharp: a **clean** one and a **watermarked**
   one (grey band + copyright text).
4. Base64-encodes both derivatives and POSTs `{ hidrive_path, event_id, metadata,
   clean_jpeg_base64, watermarked_jpeg_base64 }` to the app's `/api/ingest/receive` (with the
   `x-ingest-secret` header). The **app** then uploads to the storage buckets, upserts the
   `photos` row + `athletes` + `photo_athletes`, and sets `ingest_status='done'`; a DB trigger
   keeps `events.photo_count` in sync. Idempotent per `hidrive_original_path` (enforced app-side).

> Newly ingested photos land hidden (`is_published=false`) and do **not** appear in the public
> gallery until explicitly published — so you can push one photo through and inspect the
> watermark + metadata privately first. See [`SECRETS.md`](../SECRETS.md) / the app for how to
> publish.

## Setup

```bash
cd worker
npm install                 # pulls sharp + exifr + tsx
sudo apt-get install -y libimage-exiftool-perl fontconfig fonts-dejavu-core   # exiftool + a font for the watermark
cp .env.example .env        # fill in HiDrive WebDAV + APP_INGEST_URL + INGEST_RECEIVE_SECRET
```

`worker/.env` is loaded automatically at startup (via `dotenv`, resolved relative to the
entry point), so `npm run ingest` / `poll` / `serve` pick up the values without any
`set -a; . ./.env` dance.

> `/api/ingest/receive` only exists once the app is **published** from Lovable Cloud (and
> `INGEST_RECEIVE_SECRET` is set as an app secret). Until then the worker's POSTs will 404.

`fontconfig` + a sans font (e.g. DejaVu) must be installed so librsvg can render the
watermark text.

## Usage

```bash
# Ingest one master (best way to test end-to-end on a single tagged JPEG):
npm run ingest -- "ingest/NGU_20250914_0001.jpg" "<event-uuid>"

# Scan the ingest folder once (cron this, e.g. every 5 min):
npm run poll -- "<event-uuid>"

# Optional HTTP trigger for Make.com (requires INGEST_TRIGGER_SECRET):
npm run serve
#   curl -X POST "http://<vps>:8787/ingest-poll" \
#        -H "x-ingest-secret: $INGEST_TRIGGER_SECRET" \
#        -H "content-type: application/json" -d '{"event_id":"<event-uuid>"}'
```

`event_id` is optional; pass it so the photos land on an event and its `photo_count` updates.

## Cron example

```
*/5 * * * * cd /opt/sideline/worker && /usr/bin/npm run poll -- "<event-uuid>" >> /var/log/sideline-ingest.log 2>&1
```
