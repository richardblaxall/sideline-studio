import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getAccessStatus, getCleanPreviews } from "@/lib/sideline.functions";

export type AccessStatus = "anonymous" | "checking" | "pending" | "approved";

type AuthResult = { ok: boolean; message?: string; needsConfirmation?: boolean };

type AccessContextValue = {
  /** Signed in AND approved on the invite list — unlocks clean previews + downloads. */
  isUnlocked: boolean;
  isSignedIn: boolean;
  email: string | null;
  status: AccessStatus;
  previews: Record<string, string>;
  signIn: (args: { email: string; password: string }) => Promise<AuthResult>;
  signUp: (args: { email: string; password: string }) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  /** Loads clean (un-watermarked) previews for one event once approved. */
  ensurePreviews: (eventId: string) => void;
};

const AccessContext = createContext<AccessContextValue | null>(null);

export function AccessProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [status, setStatus] = useState<AccessStatus>("anonymous");
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const loaded = useRef<Set<string>>(new Set());
  const runStatus = useServerFn(getAccessStatus);
  const runPreviews = useServerFn(getCleanPreviews);

  const loadPreviews = useCallback(
    async (eventId: string) => {
      const result = await runPreviews({ data: { event_id: eventId } });
      if (!result.ok) return;
      setPreviews((prev) => ({ ...prev, ...result.previews }));
    },
    [runPreviews],
  );

  const refreshStatus = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) {
      setEmail(null);
      setStatus("anonymous");
      setPreviews({});
      loaded.current = new Set();
      return;
    }
    setEmail(user.email ?? null);
    setStatus("checking");
    try {
      const result = await runStatus();
      setStatus(result.approved ? "approved" : "pending");
      if (result.approved) {
        const pending = Array.from(loaded.current);
        loaded.current = new Set();
        for (const eventId of pending) {
          loaded.current.add(eventId);
          void loadPreviews(eventId);
        }
      }
    } catch {
      setStatus("pending");
    }
  }, [runStatus, loadPreviews]);

  useEffect(() => {
    void refreshStatus();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      void refreshStatus();
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshStatus]);

  const signIn = useCallback(async ({ email: mail, password }: { email: string; password: string }) => {
    const { error } = await supabase.auth.signInWithPassword({ email: mail, password });
    if (error) return { ok: false, message: error.message };
    await refreshStatus();
    return { ok: true };
  }, [refreshStatus]);

  const signUp = useCallback(async ({ email: mail, password }: { email: string; password: string }) => {
    const { data, error } = await supabase.auth.signUp({
      email: mail,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) return { ok: false, message: error.message };
    if (!data.session) return { ok: true, needsConfirmation: true };
    await refreshStatus();
    return { ok: true };
  }, [refreshStatus]);

  const ensurePreviews = useCallback(
    (eventId: string) => {
      if (loaded.current.has(eventId)) return;
      loaded.current.add(eventId);
      if (status !== "approved") return;
      void loadPreviews(eventId);
    },
    [status, loadPreviews],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setEmail(null);
    setStatus("anonymous");
    setPreviews({});
    loaded.current = new Set();
  }, []);

  const value = useMemo<AccessContextValue>(
    () => ({
      isUnlocked: status === "approved",
      isSignedIn: status !== "anonymous",
      email,
      status,
      previews,
      signIn,
      signUp,
      signOut,
      ensurePreviews,
    }),
    [status, email, previews, signIn, signUp, signOut, ensurePreviews],
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessContextValue {
  const ctx = useContext(AccessContext);
  if (!ctx) throw new Error("useAccess must be used inside AccessProvider");
  return ctx;
}
