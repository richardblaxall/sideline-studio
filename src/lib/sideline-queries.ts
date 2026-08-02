import { supabase } from "@/integrations/supabase/client";

export type SidelineEvent = {
  id: string;
  title: string;
  season: string;
  event_date: string | null;
  location: string | null;
  cover_photo_url: string | null;
  photo_count: number;
};

export type Athlete = {
  id: string;
  full_name: string;
  jersey_number: string | null;
  team_name: string | null;
};

export type Exif = {
  shutter?: string;
  iso?: string;
  focal_length?: string;
  camera_model?: string;
  aperture?: string;
  lens?: string;
};

export type SidelinePhoto = {
  id: string;
  event_id: string | null;
  public_watermarked_url: string | null;
  headline: string | null;
  caption: string | null;
  date_taken: string | null;
  width: number | null;
  height: number | null;
  exif_data: Exif | null;
  athletes: Athlete[];
};

const EVENT_COLUMNS = "id, title, season, event_date, location, cover_photo_url, photo_count";

export async function fetchSeasons(): Promise<string[]> {
  const { data, error } = await supabase.from("events").select("season");
  if (error) throw error;
  const seasons = Array.from(new Set((data ?? []).map((row) => row.season as string)));
  return seasons.sort().reverse();
}

export async function fetchEvents(season: string): Promise<SidelineEvent[]> {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("season", season)
    .order("event_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as SidelineEvent[];
}

export async function fetchEvent(id: string): Promise<SidelineEvent | null> {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as SidelineEvent) ?? null;
}

export async function fetchAthletes(): Promise<Athlete[]> {
  const { data, error } = await supabase
    .from("athletes")
    .select("id, full_name, jersey_number, team_name");
  if (error) throw error;
  return (data ?? []) as Athlete[];
}

export async function fetchEventPhotos(eventId: string): Promise<SidelinePhoto[]> {
  const { data, error } = await supabase
    .from("photos")
    .select(
      "id, event_id, public_watermarked_url, headline, caption, date_taken, width, height, exif_data, photo_athletes(athletes(id, full_name, jersey_number, team_name))",
    )
    .eq("event_id", eventId)
    .order("date_taken", { ascending: true });
  if (error) throw error;

  type Row = Omit<SidelinePhoto, "athletes"> & {
    photo_athletes: { athletes: Athlete | null }[] | null;
  };

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    ...row,
    athletes: (row.photo_athletes ?? [])
      .map((link) => link.athletes)
      .filter((a): a is Athlete => Boolean(a)),
  }));
}

/** Matches an athlete by name or jersey number, or an event by title/location. */
export function matchesQuery(query: string, values: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return values.some((value) => (value ?? "").toLowerCase().includes(q));
}

export function formatEventDate(date: string | null): string {
  if (!date) return "Date TBC";
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function monthKey(date: string | null): string {
  if (!date) return "Unscheduled";
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}
