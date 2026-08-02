import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, ShieldCheck, X } from "lucide-react";
import { useAccess } from "./access-provider";

type Props = {
  open: boolean;
  onClose: () => void;
};

type Mode = "signin" | "signup";

export function LoginModal({ open, onClose }: Props) {
  const { signIn, signUp, status } = useAccess();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reset = () => {
    setError(null);
    setNotice(null);
  };

  const submit = async () => {
    const mail = email.trim().toLowerCase();
    if (!mail || password.length < 6) {
      setError("Enter your email and a password of at least 6 characters.");
      return;
    }
    setPending(true);
    reset();
    const result = mode === "signin" ? await signIn({ email: mail, password }) : await signUp({ email: mail, password });
    setPending(false);

    if (!result.ok) {
      setError(result.message ?? "Something went wrong. Try again.");
      return;
    }
    if (result.needsConfirmation) {
      setNotice("Account created. Confirm your email address, then sign in.");
      setPassword("");
      return;
    }
    setPassword("");
    if (status === "pending") {
      setNotice("Signed in. Your account is awaiting access approval.");
      return;
    }
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
            aria-label="Client account"
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
              <ShieldCheck className="size-4" />
              <span className="label-caps">Client access</span>
            </div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight">
              {mode === "signin" ? "Sign in" : "Create your account"}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Sideline is invite-only. Create an account with the email address we hold for you —
              downloads unlock once that address is confirmed and approved.
            </p>

            <div className="mt-6 space-y-4">
              <div>
                <label htmlFor="sl-email" className="label-caps text-muted-foreground">
                  Email
                </label>
                <input
                  id="sl-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@club.com"
                  className="mt-2 w-full border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-accent"
                />
              </div>
              <div>
                <label htmlFor="sl-password" className="label-caps text-muted-foreground">
                  Password
                </label>
                <input
                  id="sl-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submit();
                  }}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  placeholder="••••••••"
                  className="mt-2 w-full border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-accent"
                />
              </div>
            </div>

            {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
            {notice && <p className="mt-4 text-sm text-accent">{notice}</p>}

            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 bg-chrome px-4 py-2.5 text-sm font-medium text-chrome-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                reset();
              }}
              className="mt-4 w-full text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {mode === "signin" ? "No account yet? Create one" : "Already have an account? Sign in"}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
