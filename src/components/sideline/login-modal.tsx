import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { KeyRound, Loader2, X } from "lucide-react";
import { useAccess } from "./access-provider";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function LoginModal({ open, onClose }: Props) {
  const { unlock } = useAccess();
  const [passcode, setPasscode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = passcode.trim();
    if (!trimmed) return;
    setPending(true);
    setError(null);
    const result = await unlock({ passcode: trimmed });
    setPending(false);
    if (!result.ok) {
      setError(
        result.reason === "unavailable"
          ? "Access service unavailable. Try again shortly."
          : "That passcode is not valid.",
      );
      return;
    }
    setPasscode("");
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-chrome/60 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            className="relative w-full max-w-md border border-border bg-card p-7"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label="Client login"
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-4 top-4 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>

            <div className="flex items-center gap-2 text-accent">
              <KeyRound className="size-4" />
              <span className="label-caps">Client access</span>
            </div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight">Client login</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Enter your client passcode to unlock clean previews and high-resolution downloads
              across every gallery.
            </p>

            <div className="mt-6">
              <label htmlFor="sl-passcode" className="label-caps text-muted-foreground">
                Passcode
              </label>
              <input
                id="sl-passcode"
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
                autoComplete="current-password"
                placeholder="••••••••"
                className="mt-2 w-full border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-accent"
              />
            </div>

            {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

            <button
              type="button"
              onClick={submit}
              disabled={pending || !passcode.trim()}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 bg-chrome px-4 py-2.5 text-sm font-medium text-chrome-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Unlock downloads
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
