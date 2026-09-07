import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";

interface Options<T> {
  /** The current draft. Compared by structural equality, not identity. */
  value: T;
  /** False while the draft is incomplete — an invalid draft is never sent. */
  enabled: boolean;
  save: (value: T) => Promise<void>;
  delayMs?: number;
}

interface Autosave {
  state: SaveState;
  error: Error | null;
  savedAt: number | null;
  /** Save now rather than on the timer. Resolves once the write settles. */
  flush: () => Promise<void>;
  /** Treat the current value as saved — after a load, or a save made elsewhere. */
  markSaved: () => void;
}

/**
 * Save a draft shortly after it stops changing.
 *
 * This is what replaces v1's four-step product wizard, and the reason the
 * replacement is worth the trouble: each step of that stepper wrote straight
 * to Stripe, so abandoning it halfway left orphaned Products in a live Stripe
 * account, and changing one price meant clicking through four screens. Here
 * the draft is ours, it saves itself to our own database, and Stripe is only
 * ever written on an explicit Publish.
 *
 * Two rules keep it honest:
 *
 *   - an invalid draft is never sent, so autosave cannot persist a half-typed
 *     product that the API would reject anyway;
 *   - a save in flight is never overtaken. A change made while saving marks
 *     the draft dirty again and re-runs afterwards, so the last thing typed is
 *     the last thing written.
 */
export function useAutosave<T>({ value, enabled, save, delayMs = 900 }: Options<T>): Autosave {
  const [state, setState] = useState<SaveState>("clean");
  const [error, setError] = useState<Error | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const serialised = JSON.stringify(value);

  // Refs, so the debounce timer never closes over a stale draft or callback.
  const valueRef = useRef(value);
  const saveRef = useRef(save);
  const savedRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  valueRef.current = value;
  saveRef.current = save;

  const run = useCallback(async () => {
    if (inFlight.current) return;

    const snapshot = JSON.stringify(valueRef.current);
    if (snapshot === savedRef.current) return;

    inFlight.current = true;
    setState("saving");
    setError(null);

    try {
      await saveRef.current(valueRef.current);
      savedRef.current = snapshot;
      setSavedAt(Date.now());

      // Anything typed during the write leaves the draft dirty again.
      setState(JSON.stringify(valueRef.current) === snapshot ? "saved" : "dirty");
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error("Could not save."));
      setState("error");
    } finally {
      inFlight.current = false;
    }
  }, []);

  const markSaved = useCallback(() => {
    savedRef.current = JSON.stringify(valueRef.current);
    setState("clean");
    setError(null);
  }, []);

  useEffect(() => {
    // Nothing has been loaded yet; adopt the first value as the baseline
    // rather than immediately writing it back.
    if (savedRef.current === null) {
      savedRef.current = serialised;
      return;
    }

    if (!enabled || serialised === savedRef.current) return;

    setState((current) => (current === "saving" ? current : "dirty"));

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), delayMs);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [serialised, enabled, delayMs, run]);

  // Retry once a save in flight finishes and the draft is still behind.
  useEffect(() => {
    if (state !== "dirty" || inFlight.current || !enabled) return;

    const retry = setTimeout(() => void run(), delayMs);
    return () => clearTimeout(retry);
  }, [state, enabled, delayMs, run]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await run();
  }, [run]);

  /**
   * Warn before a reload or a close that would drop unsaved work.
   *
   * Only for the browser's own navigation; in-app navigation is handled by the
   * editor, which flushes on unmount.
   */
  useEffect(() => {
    if (state !== "dirty" && state !== "error") return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [state]);

  return { state, error, savedAt, flush, markSaved };
}
