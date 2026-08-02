# Sideline Studio

Build a Getty Images–style sports photography platform called "Sideline" using React, Tailwind CSS, lucide-react icons, and Framer Motion. Enable Lovable Cloud (managed Postgres, RLS, storage buckets, edge functions).

DESIGN DIRECTION

Editorial and dense, inspired by Getty/Alamy: near-white canvas, charcoal chrome, one restrained accent. System sans, tight tracking on labels. Photography is the hero — minimal UI furniture, generous grid, no drop shadows on cards. Fast, quiet, professional.

DATABASE SCHEMA (Lovable Cloud / Postgres)

Table `events`:

  id uuid pk default gen_random_uuid(), title text, season text, event_date date,

  location text, cover_photo_url text, photo_count int default 0, created_at timestamptz default now().

Table `athletes`:

  id uuid pk default gen_random_uuid(), full_name text, jersey_number text, team_name text.

Table `photos`:

  id uuid pk default gen_random_uuid(), event_id uuid references events(id) on delete cascade,

  hidrive_original_path text,        -- master file location, never exposed to public

  public_watermarked_url text,       -- downsized + burned-in watermark (public bucket)

  clean_preview_url text,            -- downsized, no watermark (private bucket, RLS-gated)

  headline text, caption text, date_taken timestamptz,

  width int, height int,             -- for masonry layout without reflow

  exif_data jsonb,                   -- {shutter, iso, focal_length, camera_model, aperture, lens}

  ingest_status text default 'pending', processed_at timestamptz,

  created_at timestamptz default now().

Table `photo_athletes` (junction):

  photo_id uuid references photos(id) on delete cascade,

  athlete_id uuid references athletes(id) on delete cascade,

  primary key (photo_id, athlete_id).

Table `event_access` (private gallery auth):

  id uuid pk default gen_random_uuid(), event_id uuid references events(id) on delete cascade,

  passcode_hash text, access_token text unique, expires_at timestamptz, created_at timestamptz default now().

STORAGE BUCKETS

  `public-previews`  — public read. Holds watermarked downsized JPEGs.

  `private-previews` — no public read; access via edge function only. Holds clean downsized JPEGs.

RLS

  events, athletes, photos, photo_athletes: public SELECT (anon) allowed — this is a public catalogue.

  event_access: no client access at all; server/edge-function only.

  Do NOT expose hidrive_original_path or clean_preview_url to the anonymous client — only public_watermarked_url is returned to unauthenticated users. Handle the private variants through edge functions.

EDGE FUNCTIONS (scaffold signatures only — backend wiring done later via Claude Code)

  `verify-access`     POST {event_id, passcode | token} -> returns short-lived JWT if valid.

  `download-original` POST {photo_id} + Authorization: Bearer <JWT> -> returns time-limited download URL.

  `ingest-photo`      POST {hidrive_path} -> placeholder; will parse IPTC/EXIF + build previews later.

PAGES & UI

1. Season Collections "/" :

   - Sticky header: wordmark left; centre global search input (placeholder "Search athletes, jersey numbers, events"); season dropdown (default "2025/26 Season"); "Client Login" button right.

   - Global search queries athlete full_name, jersey_number, and event title/location across the season.

   - Match grid: event cards grouped chronologically by month. Each card: cover_photo_url, title, formatted event_date, location, and a photo_count badge. Hover: subtle scale via Framer Motion.

2. Match Gallery "/match/:id" :

   - Breadcrumb: Seasons > {season} > {event title}.

   - Match-scoped search bar.

   - Getty-style masonry grid using stored width/height for aspect ratios (react-masonry or CSS columns). Lazy-load images.

   - HOVER MAGNIFICATION LENS: on thumbnail hover, show a floating magnified pane of the same preview that tracks the cursor, for close athlete inspection. Smooth, debounced.

   - IMPORTANT: previews are ALREADY watermarked by the backend. Do NOT draw a CSS watermark band. DO disable context menu (onContextMenu preventDefault) and drag (onDragStart preventDefault, draggable=false) on all images.

   - METADATA DRAWER: clicking a photo opens a right-hand sliding drawer (Framer Motion) showing: headline, caption; clickable athlete badges rendered as "#{jersey_number} {full_name}" — clicking a badge filters the current gallery to photos tagged with that athlete; EXIF block (shutter, ISO, focal length, camera model) from exif_data; a photographer copyright line.

3. Client Login modal :

   - Accepts a passcode OR an access token (also readable from a ?token= URL param).

   - Calls verify-access; on success stores the returned JWT in memory (React state, NOT localStorage) and switches the current gallery to AUTHENTICATED mode.

   - Authenticated mode: swaps image sources to clean_preview_url (fetched via edge function), reveals a "Download High-Res" button in each drawer, and shows a persistent "Batch Download Selected" action bar with per-photo selection checkboxes on the grid.

Seed 1 example event with ~8 placeholder photos and 3 athletes so the UI is demonstrable. Use React state for all interaction; do not use HTML <form> submits for the login modal — use button onClick handlers.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/cc06cd84-8b1d-4809-8a91-55bdae0053c7).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
