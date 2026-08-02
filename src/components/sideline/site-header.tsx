import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useAccess } from "./access-provider";

type Props = {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder?: string;
  seasons?: string[];
  season?: string;
  onSeasonChange?: (season: string) => void;
  onLoginClick: () => void;
};

export function SiteHeader({
  query,
  onQueryChange,
  placeholder = "Search athletes, jersey numbers, events",
  seasons,
  season,
  onSeasonChange,
  onLoginClick,
}: Props) {
  const { isUnlocked: unlocked, isSignedIn, status, signOut } = useAccess();


  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-4 px-5 sm:px-8">
        <Link to="/" className="flex shrink-0 items-baseline gap-1.5">
          <span className="text-lg font-bold tracking-[-0.03em]">SIDELINE</span>
          <span className="hidden label-caps text-accent sm:inline">Sports Wire</span>
        </Link>

        <div className="relative mx-auto hidden w-full max-w-xl md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="w-full border border-input bg-surface py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-accent focus:bg-background"
          />
        </div>

        <div className="ml-auto flex items-center gap-3">
          {seasons && season && onSeasonChange && (
            <select
              value={season}
              onChange={(e) => onSeasonChange(e.target.value)}
              aria-label="Season"
              className="hidden border border-input bg-background px-2 py-2 text-sm outline-none focus:border-accent sm:block"
            >
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}

          {unlocked ? (
            <button
              type="button"
              onClick={lock}
              className="label-caps border border-accent px-3 py-2.5 text-accent transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Client mode · Lock
            </button>
          ) : (
            <button
              type="button"
              onClick={onLoginClick}
              className="label-caps bg-chrome px-3.5 py-2.5 text-chrome-foreground transition-opacity hover:opacity-90"
            >
              Client Login
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-border px-5 py-2 md:hidden">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="w-full border border-input bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:border-accent"
          />
        </div>
      </div>
    </header>
  );
}
