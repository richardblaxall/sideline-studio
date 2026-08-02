import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { verifyAccess, getCleanPreviews } from "@/lib/sideline.functions";

type AccessState = {
  eventId: string | null;
  /** Short-lived JWT. Kept in memory only — never persisted to storage. */
  token: string | null;
  previews: Record<string, string>;
};

type AccessContextValue = {
  isUnlockedFor: (eventId: string) => boolean;
  token: string | null;
  previews: Record<string, string>;
  unlock: (args: {
    eventId: string;
    passcode?: string;
    token?: string;
  }) => Promise<{ ok: boolean; reason?: string }>;
  lock: () => void;
};

const AccessContext = createContext<AccessContextValue | null>(null);

export function AccessProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccessState>({
    eventId: null,
    token: null,
    previews: {},
  });
  const runVerify = useServerFn(verifyAccess);
  const runPreviews = useServerFn(getCleanPreviews);

  const unlock = useCallback(
    async ({ eventId, passcode, token }: { eventId: string; passcode?: string; token?: string }) => {
      const result = await runVerify({
        data: { event_id: eventId, passcode, token },
      });
      if (!result.ok) return { ok: false, reason: result.reason };

      const preview = await runPreviews({
        data: { event_id: eventId, access_token: result.token },
      });
      setState({ eventId, token: result.token, previews: preview.previews });
      return { ok: true };
    },
    [runVerify, runPreviews],
  );

  const lock = useCallback(() => {
    setState({ eventId: null, token: null, previews: {} });
  }, []);

  const value = useMemo<AccessContextValue>(
    () => ({
      isUnlockedFor: (eventId: string) => Boolean(state.token) && state.eventId === eventId,
      token: state.token,
      previews: state.previews,
      unlock,
      lock,
    }),
    [state, unlock, lock],
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessContextValue {
  const ctx = useContext(AccessContext);
  if (!ctx) throw new Error("useAccess must be used inside AccessProvider");
  return ctx;
}
