import { motion } from "framer-motion";
import { Check } from "lucide-react";
import type { SidelinePhoto } from "@/lib/sideline-queries";

type Props = {
  photo: SidelinePhoto;
  src: string;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: (photoId: string) => void;
  onOpen: (photo: SidelinePhoto) => void;
};

export function PhotoTile({ photo, src, selectable, selected, onToggleSelect, onOpen }: Props) {
  const ratio = photo.width && photo.height ? photo.width / photo.height : 1.5;

  return (
    <motion.div
      className="group relative mb-4 break-inside-avoid bg-surface"
      whileHover={{ scale: 1.006 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      <div
        className="relative w-full cursor-pointer overflow-hidden"
        style={{ aspectRatio: String(ratio) }}
        onClick={() => onOpen(photo)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onOpen(photo);
        }}
        aria-label={photo.headline ?? "Photograph"}
      >
        <img
          src={src}
          alt={photo.headline ?? "Match photograph"}
          loading="lazy"
          {...(photo.width ? { width: photo.width } : {})}
          {...(photo.height ? { height: photo.height } : {})}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
          className="no-save size-full object-cover"
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-chrome/85 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
        <p className="line-clamp-2 text-xs leading-snug text-chrome-foreground">
          {photo.headline}
        </p>
      </div>

      {selectable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(photo.id);
          }}
          aria-label={selected ? "Deselect photo" : "Select photo"}
          aria-pressed={selected}
          className={`absolute left-3 top-3 z-30 flex size-6 items-center justify-center border transition-colors ${
            selected
              ? "border-accent bg-accent text-accent-foreground"
              : "border-chrome-foreground/70 bg-chrome/40 text-transparent hover:bg-chrome/70"
          }`}
        >
          <Check className="size-4" />
        </button>
      )}
    </motion.div>
  );
}
