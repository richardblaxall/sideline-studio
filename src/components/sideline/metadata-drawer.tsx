import { AnimatePresence, motion } from "framer-motion";
import { Download, X } from "lucide-react";
import type { SidelinePhoto } from "@/lib/sideline-queries";

type Props = {
  photo: SidelinePhoto | null;
  src: string | null;
  unlocked: boolean;
  onClose: () => void;
  onAthleteClick: (athleteId: string) => void;
  onDownload: (photo: SidelinePhoto) => void;
};


export function MetadataDrawer({
  photo,
  src,
  unlocked,
  onClose,
  onAthleteClick,
  onDownload,
}: Props) {
  return (
    <AnimatePresence>
      {photo && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-chrome/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.aside
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            aria-label="Photo metadata"
          >
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <span className="label-caps text-accent">Frame detail</span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close details"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            {src && (
              <img
                src={src}
                alt={photo.headline ?? "Match photograph"}
                loading="lazy"
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                onContextMenu={(e) => e.preventDefault()}
                className="no-save w-full bg-surface object-cover"
              />
            )}

            <div className="px-6 py-5">
              <h2 className="text-lg font-semibold leading-snug tracking-tight">
                {photo.headline}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{photo.caption}</p>

              {photo.athletes.length > 0 && (
                <div className="mt-6">
                  <span className="label-caps text-muted-foreground">Athletes tagged</span>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {photo.athletes.map((athlete) => (
                      <button
                        key={athlete.id}
                        type="button"
                        onClick={() => onAthleteClick(athlete.id)}
                        className="border border-input px-2.5 py-1.5 text-xs transition-colors hover:border-accent hover:text-accent"
                      >
                        #{athlete.jersey_number} {athlete.full_name}
                      </button>
                    ))}
                  </div>
                </div>
              )}


              {unlocked && (
                <button
                  type="button"
                  onClick={() => onDownload(photo)}
                  className="mt-7 inline-flex w-full items-center justify-center gap-2 bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
                >
                  <Download className="size-4" />
                  Download High-Res
                </button>
              )}

              <p className="mt-7 text-xs leading-relaxed text-muted-foreground">
                © {new Date().getFullYear()} Sideline Sports Wire. Photograph by the Sideline
                touchline team. All rights reserved — no reproduction without a licence.
              </p>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
