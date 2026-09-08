import { useEffect, useRef } from "react";
import { useCustomer } from "@/lib/account";
import { useCart } from "@/store/cart";
import { csrfPost } from "@/lib/api";

const SYNC_DELAY_MS = 2000;

/**
 * Mirror the cart server-side, shortly after it stops changing.
 *
 * Silent and best-effort — nothing here surfaces to the shopper, and a failed
 * sync is not retried beyond the next change. Only runs for a signed-in
 * customer: a guest's cart never reaches the server, so there is no address
 * to remind and nothing worth syncing. The server itself no-ops this while
 * the merchant has not turned the feature on — see server/cart-recovery.ts —
 * so this hook does not need to know whether it is enabled.
 *
 * Not `useAutosave` (src/admin/useAutosave.ts): that hook is admin-only code,
 * and importing it here would pull the whole admin bundle into the
 * storefront's — see the code-splitting note in src/router.tsx.
 */
export function useCartRecoverySync(): void {
  const customer = useCustomer();
  const lines = useCart((s) => s.lines);
  const signedIn = Boolean(customer.data);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSynced = useRef<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;

    const serialised = JSON.stringify(lines);
    if (serialised === lastSynced.current) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      lastSynced.current = serialised;
      csrfPost("/cart/sync", { lines }).catch(() => {
        // Best-effort: the next change tries again.
      });
    }, SYNC_DELAY_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [signedIn, lines]);
}
