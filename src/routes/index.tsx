import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ImageIcon, MapPin } from "lucide-react";
import { SiteHeader } from "@/components/sideline/site-header";
import { LoginModal } from "@/components/sideline/login-modal";
import {
  fetchAthletes,
  fetchEvents,
  fetchSeasons,
  formatEventDate,
  matchesQuery,
  monthKey,
  type SidelineEvent,
} from "@/lib/sideline-queries";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sideline — Season Collections | Sports Photography Wire" },
      {
        name: "description",
        content:
          "Browse Sideline's season collections of match photography. Search athletes, jersey numbers and fixtures, then open a match gallery.",
      },
      { property: "og:title", content: "Sideline — Season Collections" },
      {
        property: "og:description",
        content:
          "Editorial sports photography by match. Search athletes, jersey numbers and fixtures across the season.",
      },
    ],
  }),
  component: SeasonCollections,
});

const DEFAULT_SEASON = "2025/26 Season";

function SeasonCollections() {
  const [query, setQuery] = useState("");
  const [season, setSeason] = useState(DEFAULT_SEASON);
  const [loginOpen, setLoginOpen] = useState(false);

  const seasonsQuery = useQuery({ queryKey: ["seasons"], queryFn: fetchSeasons });
  const eventsQuery = useQuery({
    queryKey: ["events", season],
    queryFn: () => fetchEvents(season),
  });
  const athletesQuery = useQuery({ queryKey: ["athletes"], queryFn: fetchAthletes });

  const events = eventsQuery.data ?? [];
  const athletes = athletesQuery.data ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return events;
    const athleteTeams = athletes
      .filter((a) => matchesQuery(q, [a.full_name, a.jersey_number]))
      .map((a) => a.team_name ?? "");
    return events.filter(
      (event) =>
        matchesQuery(q, [event.title, event.location]) ||
        athleteTeams.some((team) => team && event.title.toLowerCase().includes(team.toLowerCase())),
    );
  }, [events, athletes, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, SidelineEvent[]>();
    for (const event of filtered) {
      const key = monthKey(event.event_date);
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader
        query={query}
        onQueryChange={setQuery}
        seasons={seasonsQuery.data ?? [DEFAULT_SEASON]}
        season={season}
        onSeasonChange={setSeason}
        onLoginClick={() => setLoginOpen(true)}
      />

      <main className="mx-auto max-w-[1600px] px-5 py-10 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
          <div>
            <span className="label-caps text-accent">Season collections</span>
            <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] sm:text-4xl">{season}</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "fixture" : "fixtures"}
            {query && ` matching “${query}”`}
          </p>
        </div>

        {eventsQuery.isLoading && (
          <p className="py-16 text-sm text-muted-foreground">Loading fixtures…</p>
        )}

        {!eventsQuery.isLoading && grouped.length === 0 && (
          <p className="py-16 text-sm text-muted-foreground">
            No fixtures found for this search in {season}.
          </p>
        )}

        {grouped.map(([month, monthEvents]) => (
          <section key={month} className="mt-12">
            <div className="flex items-center gap-4">
              <h2 className="label-caps text-muted-foreground">{month}</h2>
              <span className="h-px flex-1 bg-border" />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {monthEvents.map((event) => (
                <motion.div
                  key={event.id}
                  whileHover={{ scale: 1.012 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Link
                    to="/match/$id"
                    params={{ id: event.id }}
                    className="block border border-border bg-card"
                  >
                    <div className="relative aspect-[3/2] overflow-hidden bg-surface">
                      {event.cover_photo_url && (
                        <img
                          src={event.cover_photo_url}
                          alt={event.title}
                          loading="lazy"
                          draggable={false}
                          onDragStart={(e) => e.preventDefault()}
                          onContextMenu={(e) => e.preventDefault()}
                          className="no-save size-full object-cover"
                        />
                      )}
                      <span className="absolute right-2 top-2 inline-flex items-center gap-1 bg-chrome/85 px-2 py-1 label-caps text-chrome-foreground">
                        <ImageIcon className="size-3" />
                        {event.photo_count}
                      </span>
                    </div>
                    <div className="p-4">
                      <h3 className="text-sm font-semibold leading-snug tracking-tight">
                        {event.title}
                      </h3>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {formatEventDate(event.event_date)}
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3" />
                        {event.location}
                      </p>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          </section>
        ))}
      </main>

      <footer className="mt-16 border-t border-border px-5 py-8 sm:px-8">
        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} Sideline Sports Wire — all frames licensed, never free.
        </p>
      </footer>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}
