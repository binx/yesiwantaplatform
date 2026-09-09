import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input } from "antd";
import { storeQueryKey } from "@/lib/useStore";
import { PageWrapper } from "./PageWrapper";

/**
 * The gate page. One field, a submit, and a line of copy that says the store
 * is not open yet — nothing about whose it is.
 *
 * Reads a share-link token from `?preview=` on mount and tries it
 * automatically, then strips it from the URL immediately: posted, not read
 * from the query string server-side, which keeps the token out of the
 * server's access log, the platform's request log, and every proxy in
 * between — see docs/tasks/27-storefront-preview-mode.md §6.
 */
export function StorefrontGate({ onUnlocked }: { onUnlocked: () => void }) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock(body: { password: string } | { token: string }) {
    setSubmitting(true);
    setError(null);

    try {
      // Not `csrfPost`: this route deliberately takes no CSRF token — the
      // only thing a forged call here could do is grant the victim read
      // access to a store whose password the attacker already knows.
      const response = await fetch("/api/storefront/unlock", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "That did not work.");
        return;
      }

      /*
       * Removed, not invalidated. The query has no active observer right
       * now — `useStore()`'s `useSuspenseQuery` unmounted the moment it
       * threw, which is what put this gate on screen — and `invalidateQueries`
       * only refetches *active* observers by default. Removing the cached
       * 401 entirely means the remount below reads a store that has never
       * been fetched, which always fetches, rather than one sitting on a
       * stale error React Query has no reason to retry on its own.
       */
      queryClient.removeQueries({ queryKey: storeQueryKey });
      onUnlocked();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Runs once, against whatever share-link token was in the URL on first load.
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("preview");
    if (!token) return;

    url.searchParams.delete("preview");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);

    void unlock({ token });
  }, []);

  return (
    <PageWrapper width="prose">
      <h1>This store is not open yet</h1>
      <p>Enter the password to preview it.</p>

      {error ? (
        <Alert type="error" showIcon description={error} style={{ marginBottom: "1rem" }} />
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (password) void unlock({ password });
        }}
      >
        <Input.Password
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          aria-label="Password"
          disabled={submitting}
        />
        <p style={{ marginTop: "1rem" }}>
          <Button type="primary" htmlType="submit" loading={submitting} disabled={!password}>
            Continue
          </Button>
        </p>
      </form>
    </PageWrapper>
  );
}
