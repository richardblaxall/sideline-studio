
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  season text NOT NULL DEFAULT '2025/26 Season',
  event_date date,
  location text,
  cover_photo_url text,
  photo_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.events TO anon, authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events public read" ON public.events FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.athletes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  jersey_number text,
  team_name text
);
GRANT SELECT ON public.athletes TO anon, authenticated;
GRANT ALL ON public.athletes TO service_role;
ALTER TABLE public.athletes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "athletes public read" ON public.athletes FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  hidrive_original_path text,
  public_watermarked_url text,
  clean_preview_url text,
  headline text,
  caption text,
  date_taken timestamptz,
  width int,
  height int,
  exif_data jsonb,
  ingest_status text NOT NULL DEFAULT 'pending',
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Column-level grants: anon/authenticated clients never see master paths or clean previews.
GRANT SELECT (id, event_id, public_watermarked_url, headline, caption, date_taken, width, height, exif_data, ingest_status, created_at)
  ON public.photos TO anon, authenticated;
GRANT ALL ON public.photos TO service_role;
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "photos public read" ON public.photos FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.photo_athletes (
  photo_id uuid NOT NULL REFERENCES public.photos(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  PRIMARY KEY (photo_id, athlete_id)
);
GRANT SELECT ON public.photo_athletes TO anon, authenticated;
GRANT ALL ON public.photo_athletes TO service_role;
ALTER TABLE public.photo_athletes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "photo_athletes public read" ON public.photo_athletes FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.event_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  passcode_hash text,
  access_token text UNIQUE,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- No client access at all: server / service role only.
GRANT ALL ON public.event_access TO service_role;
ALTER TABLE public.event_access ENABLE ROW LEVEL SECURITY;

CREATE INDEX photos_event_id_idx ON public.photos(event_id);
CREATE INDEX events_season_date_idx ON public.events(season, event_date);

-- Demo data
INSERT INTO public.events (id, title, season, event_date, location, cover_photo_url, photo_count) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Northgate United vs Halden Rovers', '2025/26 Season', '2025-09-14', 'Ashfield Park, Leeds', '/images/sideline-1.jpg', 8),
  ('22222222-2222-4222-8222-222222222222', 'Halden Rovers vs Sunderland Athletic', '2025/26 Season', '2025-10-05', 'Rovers Ground, Halden', '/images/sideline-2.jpg', 0),
  ('33333333-3333-4333-8333-333333333333', 'Northgate United vs Carrow Town', '2025/26 Season', '2025-11-22', 'Ashfield Park, Leeds', '/images/sideline-3.jpg', 0);

INSERT INTO public.athletes (id, full_name, jersey_number, team_name) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Marcus Elwood', '9', 'Northgate United'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Danny Okoye', '14', 'Northgate United'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'Tomas Reiner', '4', 'Halden Rovers');

INSERT INTO public.photos (id, event_id, hidrive_original_path, public_watermarked_url, clean_preview_url, headline, caption, date_taken, width, height, exif_data, ingest_status, processed_at) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '/hidrive/masters/NGU_20250914_0001.CR3', '/images/sideline-1.jpg', '/images/sideline-1.jpg', 'Elwood opens the scoring', 'Marcus Elwood of Northgate United strikes from the edge of the box during the second half at Ashfield Park.', '2025-09-14T15:12:04Z', 1600, 1067, '{"shutter":"1/2000","iso":"800","focal_length":"400mm","camera_model":"Canon EOS R3","aperture":"f/2.8","lens":"RF 400mm f/2.8L IS USM"}', 'processed', now()),
  ('bbbbbbbb-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '/hidrive/masters/NGU_20250914_0002.CR3', '/images/sideline-2.jpg', '/images/sideline-2.jpg', 'Reiner clears under pressure', 'Tomas Reiner heads clear as Halden Rovers defend a first-half corner.', '2025-09-14T15:26:41Z', 1067, 1600, '{"shutter":"1/1600","iso":"1000","focal_length":"200mm","camera_model":"Canon EOS R3","aperture":"f/2.0","lens":"RF 135mm f/1.8L"}', 'processed', now()),
  ('bbbbbbbb-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '/hidrive/masters/NGU_20250914_0003.CR3', '/images/sideline-3.jpg', '/images/sideline-3.jpg', 'Okoye celebrates with the away end', 'Danny Okoye turns to the travelling supporters after doubling the lead.', '2025-09-14T15:44:19Z', 1600, 1067, '{"shutter":"1/1250","iso":"640","focal_length":"300mm","camera_model":"Sony A1","aperture":"f/2.8","lens":"FE 300mm f/2.8 GM"}', 'processed', now()),
  ('bbbbbbbb-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '/hidrive/masters/NGU_20250914_0004.CR3', '/images/sideline-4.jpg', '/images/sideline-4.jpg', 'Goalkeeper full stretch', 'The Rovers keeper dives to his left to keep out a low drive.', '2025-09-14T15:58:02Z', 1600, 1067, '{"shutter":"1/2500","iso":"1250","focal_length":"400mm","camera_model":"Nikon Z9","aperture":"f/2.8","lens":"Z 400mm f/2.8 TC VR S"}', 'processed', now()),
  ('bbbbbbbb-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', '/hidrive/masters/NGU_20250914_0005.CR3', '/images/sideline-5.jpg', '/images/sideline-5.jpg', 'Elwood and Reiner contest midfield', 'Marcus Elwood shields the ball from Tomas Reiner in a physical midfield exchange.', '2025-09-14T16:04:55Z', 1067, 1600, '{"shutter":"1/1600","iso":"800","focal_length":"200mm","camera_model":"Canon EOS R3","aperture":"f/2.8","lens":"RF 70-200mm f/2.8L"}', 'processed', now()),
  ('bbbbbbbb-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', '/hidrive/masters/NGU_20250914_0006.CR3', '/images/sideline-6.jpg', '/images/sideline-6.jpg', 'Floodlights over Ashfield Park', 'General view of Ashfield Park as the floodlights take over in the second half.', '2025-09-14T16:22:30Z', 1600, 1067, '{"shutter":"1/500","iso":"2000","focal_length":"24mm","camera_model":"Canon EOS R5","aperture":"f/4.0","lens":"RF 24-70mm f/2.8L"}', 'processed', now()),
  ('bbbbbbbb-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', '/hidrive/masters/NGU_20250914_0007.CR3', '/images/sideline-7.jpg', '/images/sideline-7.jpg', 'Okoye beats his marker', 'Danny Okoye cuts inside on the touchline late in the match.', '2025-09-14T16:35:12Z', 1600, 1067, '{"shutter":"1/2000","iso":"1600","focal_length":"400mm","camera_model":"Sony A1","aperture":"f/2.8","lens":"FE 400mm f/2.8 GM"}', 'processed', now()),
  ('bbbbbbbb-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', '/hidrive/masters/NGU_20250914_0008.CR3', '/images/sideline-8.jpg', '/images/sideline-8.jpg', 'Full time on the Ashfield touchline', 'Players applaud the home support at the final whistle.', '2025-09-14T16:52:47Z', 1067, 1600, '{"shutter":"1/800","iso":"2500","focal_length":"135mm","camera_model":"Canon EOS R3","aperture":"f/1.8","lens":"RF 135mm f/1.8L"}', 'processed', now());

INSERT INTO public.photo_athletes (photo_id, athlete_id) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  ('bbbbbbbb-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  ('bbbbbbbb-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  ('bbbbbbbb-0000-4000-8000-000000000007', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  ('bbbbbbbb-0000-4000-8000-000000000008', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');

INSERT INTO public.event_access (event_id, passcode_hash, access_token, expires_at) VALUES
  ('11111111-1111-4111-8111-111111111111', 'demo:sideline2025', 'demo-access-token-ngu-0914', now() + interval '90 days');
