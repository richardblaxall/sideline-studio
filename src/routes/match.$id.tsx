import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, Download, Loader2, X } from "lucide-react";
import { SiteHeader } from "@/components/sideline/site-header";
import { LoginModal } from "@/components/sideline/login-modal";
import { PhotoTile } from "@/components/sideline/photo-tile";
import { MetadataDrawer } from "@/components/sideline/metadata-drawer";
import { useAccess } from "@/components/sideline/access-provider";
import { downloadOriginal } from "@/lib/sideline.functions";
import {
  fetchEvent,
  fetchEventPhotos,
  formatEventDate,
  matchesQuery,
  type SidelinePhoto,
} from "@/lib/sideline-queries";

export const Route = createFileRoute("/match/$id")({
  head: () => ({
    meta: [
      { title: "Match Gallery — Sideline Sports Wire" },
      {
        name: "description",
        content:
          "Full match gallery with athlete tagging and high-resolution delivery for accredited clients.",
      },
      { property: "og:title", content: "Match Gallery — Sideline Sports Wire" },
      {
        property: "og:description",
        content: "Every frame from the fixture, tagged by athlete and jersey number.",
      },
    ],
  }),
  component: MatchGallery,
});

function MatchGallery() {
  const { id } = Route.useParams();
  const { isUnlocked: unlocked, previews, token, ensurePreviews } = useAccess();
  const runDownload = useServerFn(downloadOriginal);

  const [query, setQuery] = useState("");
  const [athleteFilter, setAthleteFilter] = useState<string | null>(null);
  const [activePhoto, setActivePhoto] = useState<SidelinePhoto | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);

  const eventQuery = useQuery({ queryKey: ["event", id], queryFn: () => fetchEvent(id) });
  const photosQuery = useQuery({
    queryKey: ["event-photos", id],
    queryFn: () => fetchEventPhotos(id),
  });

  const event = eventQuery.data;
  const photos = photosQuery.data ?? [];

  // Once the client is logged in, swap in clean previews for this gallery.
  useEffect(() => {
    ensurePreviews(id);
  }, [id, unlocked, ensurePreviews]);


  const athletes = useMemo(() => {
    const map = new Map<string, SidelinePhoto["athletes"][number]>();
    for (const photo of photos) for (const a of photo.athletes) map.set(a.id, a);
    return Array.from(map.values());
  }, [photos]);

  const visible = useMemo(
    () =>
      photos.filter((photo) => {
        if (athleteFilter && !photo.athletes.some((a) => a.id === athleteFilter)) return false;
        return matchesQuery(query, [
          photo.headline,
          photo.caption,
          ...photo.athletes.flatMap((a) => [a.full_name, a.jersey_number]),
        ]);
      }),
    [photos, query, athleteFilter],
  );

  const srcFor = (photo: SidelinePhoto) =>
    (unlocked ? previews[photo.id] : null) ?? photo.public_watermarked_url ?? "";

  const toggleSelect = (photoId: string) =>
    setSelected((prev) =>
      prev.includes(photoId) ? prev.filter((p) => p !== photoId) : [...prev, photoId],
    );

  const runBatchDownload = async () => {
    if (!token) return;
    setDownloading(true);
    for (const photoId of selected) {
      const result = await runDownload({ data: { photo_id: photoId, access_token: token } });
      if (result.ok && result.url) window.open(result.url, "_blank", "noopener");
    }
    setDownloading(false);
  };

  const downloadOne = async (photo: SidelinePhoto) => {
    if (!token) return;
    const result = await runDownload({ data: { photo_id: photo.id, access_token: token } });
    if (result.ok && result.url) window.open(result.url, "_blank", "noopener");
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader
        query={query}
        onQueryChange={setQuery}
        placeholder="Search this match — athletes, jersey numbers, captions"
        onLoginClick={() => setLoginOpen(true)}
      />



      <main className="mx-auto max-w-[1600px] px-5 py-8 sm:px-8">
        <nav className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-label="Breadcrumb">
          <Link to="/" className="transition-colors hover:text-foreground">
            Seasons
          </Link>
          <ChevronRight className="size-3" />
          <span>{event?.season ?? "Season"}</span>
          <ChevronRight className="size-3" />
          <span className="text-foreground">{event?.title ?? "Match"}</span>
        </nav>

        <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">
              {event?.title ?? "Match gallery"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {formatEventDate(event?.event_date ?? null)} · {event?.location}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            {visible.length} of {photos.length} frames
            {unlocked && <span className="ml-2 text-accent">· Client mode</span>}
          </p>
        </div>

        {athletes.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="label-caps text-muted-foreground">Filter</span>
            {athletes.map((athlete) => {
              const active = athleteFilter === athlete.id;
              return (
                <button
                  key={athlete.id}
                  type="button"
                  onClick={() => setAthleteFilter(active ? null : athlete.id)}
                  className={`border px-2.5 py-1.5 text-xs transition-colors ${
                    active
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-input hover:border-accent hover:text-accent"
                  }`}
                >
                  #{athlete.jersey_number} {athlete.full_name}
                </button>
              );
            })}
            {athleteFilter && (
              <button
                type="button"
                onClick={() => setAthleteFilter(null)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" /> Clear
              </button>
            )}
          </div>
        )}

        {photosQuery.isLoading ? (
          <p className="py-16 text-sm text-muted-foreground">Loading frames…</p>
        ) : visible.length === 0 ? (
          <p className="py-16 text-sm text-muted-foreground">No frames match this filter.</p>
        ) : (
          <div className="mt-8 columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
            {visible.map((photo) => (
              <PhotoTile
                key={photo.id}
                photo={photo}
                src={srcFor(photo)}
                selectable={unlocked}
                selected={selected.includes(photo.id)}
                onToggleSelect={toggleSelect}
                onOpen={setActivePhoto}
              />
            ))}
          </div>
        )}
      </main>

      <AnimatePresence>
        {unlocked && (
          <motion.div
            className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-chrome px-5 py-3 text-chrome-foreground sm:px-8"
            initial={{ y: 60 }}
            animate={{ y: 0 }}
            exit={{ y: 60 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                {selected.length} selected
                <span className="ml-2 text-chrome-foreground/60">
                  Clean previews active — watermark-free
                </span>
              </p>
              <div className="flex items-center gap-3">
                {selected.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelected([])}
                    className="label-caps text-chrome-foreground/70 hover:text-chrome-foreground"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={runBatchDownload}
                  disabled={selected.length === 0 || downloading}
                  className="inline-flex items-center gap-2 bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {downloading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  Batch Download Selected
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <MetadataDrawer
        photo={activePhoto}
        src={activePhoto ? srcFor(activePhoto) : null}
        unlocked={unlocked}
        onClose={() => setActivePhoto(null)}
        onAthleteClick={(athleteId) => {
          setAthleteFilter(athleteId);
          setActivePhoto(null);
        }}
        onDownload={downloadOne}
      />

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />

    </div>
  );
}
