import { useEffect, useState } from "react";
import { Alert, Input, Segmented } from "antd";
import { csrfPost } from "@/lib/api";
import type { ControlProps } from "./Field";
import { cx } from "@/lib/cx";
import styles from "./MarkdownEditor.module.css";

/**
 * A Markdown field with a Write / Preview toggle.
 *
 * Extracted from the page editor when collections gained a description, so the
 * two cannot drift into different ideas of what Markdown means here. The
 * preview is rendered *by the server*, through the very function the
 * storefront uses (`server/markdown.ts`) — a second Markdown implementation in
 * the client would eventually disagree with the first about what is safe to
 * render, and the merchant would be previewing something other than what
 * shoppers get, including whatever the sanitiser decided to strip.
 *
 * The endpoint is `/admin/pages/preview` for both callers. It renders Markdown
 * and knows nothing about pages; a second route would be the same function
 * behind a different name.
 */

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minRows?: number;
  /** Forwarded from `Field` so the label stays wired to the textarea. */
  control?: ControlProps;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  minRows = 16,
  control,
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [preview, setPreview] = useState<{ body: string; html: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "preview" || preview?.body === value) return;

    let cancelled = false;

    void csrfPost<{ bodyHtml: string }>("/admin/pages/preview", { body: value }).then(
      (result) => {
        if (!cancelled) {
          setPreview({ body: value, html: result.bodyHtml });
          setError(null);
        }
      },
      (caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not render a preview.");
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [mode, value, preview?.body]);

  return (
    <>
      <Segmented
        className={cx(styles.modes)}
        value={mode}
        onChange={(next) => setMode(next as "write" | "preview")}
        options={[
          { label: "Write", value: "write" },
          { label: "Preview", value: "preview" },
        ]}
      />

      {mode === "write" ? (
        <Input.TextArea
          {...control}
          className={cx(styles.body)}
          value={value}
          autoSize={{ minRows }}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : error ? (
        <Alert type="error" showIcon title={error} />
      ) : (
        <div
          className={cx(styles.preview)}
          dangerouslySetInnerHTML={{ __html: preview?.html ?? "" }}
        />
      )}
    </>
  );
}
