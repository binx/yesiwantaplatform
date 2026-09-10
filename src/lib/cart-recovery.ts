import { useMutation } from "@tanstack/react-query";
import type { CartLine } from "@shared/cart";
import { csrfPost } from "@/lib/api";

/** Redeem a `/cart?recover=` link. See src/pages/CartPage.tsx. */
export function useRecoverCart() {
  return useMutation({
    mutationFn: (token: string) => csrfPost<{ lines: CartLine[] }>("/cart/recover", { token }),
  });
}

/** Redeem a `/unsubscribe` link. See src/pages/UnsubscribeCartRecoveryPage.tsx. */
export function useUnsubscribeCartRecovery() {
  return useMutation({
    mutationFn: (token: string) => csrfPost<void>("/cart/unsubscribe", { token }),
  });
}
