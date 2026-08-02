# Sideline ingest worker

Standalone Node program that ingests master JPEGs from IONOS HiDrive into Supabase. It is
**not** part of the Cloudflare Workers app bundle — it runs on your VPS because it needs
`sharp` (native libvips) and, ideally, the `exiftool` binary. See the main
[`SECRETS.md`](../SECRETS.md) for how the secrets split across the app and this worker.

## What it does

1. Reads a master JPEG from HiDrive over WebDAV.
2. Parses metadata (exiftool primary, exifr fallback): EXIF (shutter/iso/focal/aperture/
   camera/lens), `photoshop:Headline`, `dc:description`, and **Persons Shown** from XMP
   `Iptc4xmpExt:PersonInImage` (jersey numbers like `Marcus Elwood #9` are split out).
3. Builds two ~1600px long-edge derivatives with sharp: a **clean** one (uploaded to the
   private `private-previews` bucket) and a **watermarked** one (grey band + copyright text,
   uploaded to the public `public-previews` bucket).
4. Upserts the `photos` row + `athletes` + `photo_athletes`, sets `ingest_status='done'`, and
   recomputes `events.photo_count`. Idempotent per `hidrive_original_path`.

## Setup

```bash
cd worker
npm install                 # pulls sharp + exifr + tsx
sudo apt-get install -y libimage-exiftool-perl fontconfig fonts-dejavu-core   # exiftool + a font for the watermark
cp .env.example .env        # fill in HiDrive + Supabase values
```

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
