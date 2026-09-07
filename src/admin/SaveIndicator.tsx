import { useEffect, useState } from "react";
import { CheckCircleFilled, LoadingOutlined, WarningFilled } from "@ant-design/icons";
import type { SaveState } from "./useAutosave";
import { cx } from "@/lib/cx";
import styles from "./SaveIndicator.module.css";

interface SaveIndicatorProps {
  autosave: { state: SaveState; savedAt: number | null };
  /** False while the draft has problems and is deliberately not being sent. */
  valid: boolean;
}

/**
 * What autosave is doing, said plainly.
 *
 * An editor that saves itself has to be legible about it, or the user cannot
 * tell "saved" from "silently failing" — which is precisely how v1 behaved:
 * its error handling was `console.log` and return (findings 27–34), so a
 * failed write looked exactly like a successful one.
 *
 * Announced politely so a screen reader hears the outcome without having the
 * cursor yanked out of the field being typed in.
 */
export function SaveIndicator({ autosave, valid }: SaveIndicatorProps) {
  const [, tick] = useState(0);

  // "Saved 2 minutes ago" has to keep counting on its own.
  useEffect(() => {
    if (autosave.state !== "saved") return;
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [autosave.state]);

  const content = describe(autosave, valid);

  return (
    <span className={cx(styles.indicator, styles[content.tone])} role="status" aria-live="polite">
      {content.icon}
      {content.text}
    </span>
  );
}

function describe(
  autosave: { state: SaveState; savedAt: number | null },
  valid: boolean,
): { tone: "muted" | "good" | "bad"; icon: React.ReactNode; text: string } {
  switch (autosave.state) {
    case "saving":
      return { tone: "muted", icon: <LoadingOutlined />, text: "Saving…" };

    case "error":
      return { tone: "bad", icon: <WarningFilled />, text: "Not saved" };

    case "saved":
      return {
        tone: "good",
        icon: <CheckCircleFilled />,
        text: `Saved ${relative(autosave.savedAt)}`,
      };

    case "dirty":
      return {
        tone: "muted",
        icon: null,
        text: valid ? "Saving shortly…" : "Waiting for the details below",
      };

    default:
      return { tone: "muted", icon: null, text: "Saves automatically" };
  }
}

function relative(savedAt: number | null): string {
  if (savedAt === null) return "";

  const seconds = Math.round((Date.now() - savedAt) / 1000);
  if (seconds < 45) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}
