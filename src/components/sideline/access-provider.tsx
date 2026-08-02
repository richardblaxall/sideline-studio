import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { verifyAccess, getCleanPreviews } from "@/lib/sideline.functions";

type AccessContextValue = {
  /** Global client mode — one login unlocks every gallery. */
  isUnlocked: boolean;
  /** Short-lived JWT. Kept in memory only — never persisted to storage. */
  token: string | null;
  previews: Record<string, string>;
  unlock: (args: { passcode: string }) => Promise<{ ok: boolean; reason?: string }>;
  /** Loads clean (un-watermarked) previews for one event once unlocked. */
  ensurePreviews: (eventId: string) => void;
  lock: () => void;
};

const AccessContext = createContext<AccessContextValue | null>(null);

export function AccessProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const loaded = useRef<Set<string>>(new Set());
  const runVerify = useServerFn(verifyAccess);
  const runPreviews = useServerFn(getCleanPreviews);

  const loadPreviews = useCallback(
    async (eventId: string, accessToken: string) => {
      const result = await runPreviews({ data: { event_id: eventId, access_token: accessToken } });
      if (!result.ok) return;
      setPreviews((prev) => ({ ...prev, ...result.previews }));
    },
    [runPreviews],
  );

  const unlock = useCallback(
    async ({ passcode }: { passcode: string }) => {
      const result = await runVerify({ data: { passcode } });
      if (!result.ok) return { ok: false, reason: result.reason };
      setToken(result.token);
      // Re-fetch previews for galleries visited before unlocking.
      const pending = Array.from(loaded.current);
      loaded.current = new Set();
      for (const eventId of pending) {
        loaded.current.add(eventId);
        void loadPreviews(eventId, result.token);
      }
      return { ok: true };
    },
    [runVerify, loadPreviews],
  );

  const ensurePreviews = useCallback(
    (eventId: string) => {
      if (loaded.current.has(eventId)) return;
      loaded.current.add(eventId);
      if (!token) return;
      void loadPreviews(eventId, token);
    },
    [token, loadPreviews],
  );

  const lock = useCallback(() => {
    setToken(null);
    setPreviews({});
    loaded.current = new Set();
  }, []);

  const value = useMemo<AccessContextValue>(
    () => ({
      isUnlocked: Boolean(token),
      token,
      previews,
      unlock,
      ensurePreviews,
      lock,
    }),
    [token, previews, unlock, ensurePreviews, lock],
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessContextValue {
  const ctx = useContext(AccessContext);
  if (!ctx) throw new Error("useAccess must be used inside AccessProvider");
  return ctx;
}
