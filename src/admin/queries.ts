import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  EnvironmentStatus,
  PageInput,
  EmailTestResult,
  LobTestResult,
  SettingsInput,
  PasswordChangeInput,
} from "@shared/api";
import type { Image, PageDraft } from "@shared/schema";
import type { Order, OrderStatus, RefundInput } from "@shared/orders";
import type { PostcardBack } from "@shared/postcards";
import { apiGet, csrfDelete, csrfPost, csrfPut, csrfUpload } from "@/lib/api";

/**
 * Admin reads and writes.
 *
 * Every mutation invalidates both its own list and the public store query, so
 * an edit is visible on the storefront in the same tab without a reload.
 */

export const adminKeys = {
  pages: ["admin", "pages"] as const,
  settings: ["admin", "settings"] as const,
  environment: ["admin", "environment"] as const,
  fulfilment: ["admin", "fulfilment"] as const,
  orders: (status: OrderStatus | "all", offset: number) => ["admin", "orders", status, offset] as const,
  order: (id: string) => ["admin", "order", id] as const,
};

export interface OrderPage {
  orders: Order[];
  total: number;
  limit: number;
  offset: number;
}

/** Anything the storefront renders is derived from these. */
const PUBLIC_KEYS: readonly (readonly unknown[])[] = [["store"], ["page"]];

function useInvalidate() {
  const queryClient = useQueryClient();

  return async (...keys: readonly (readonly unknown[])[]) => {
    await Promise.all(
      [...keys, ...PUBLIC_KEYS].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  };
}

/* ------------------------------------------------------------------ images */

/** Uploads a logo and returns it; the theme editor holds it until Save. */
export function useUploadLogo() {
  return useMutation({
    mutationFn: ({ file, alt }: { file: File; alt: string }) =>
      csrfUpload<Image>("/admin/settings/logo", file, { alt }),
  });
}

export function useUploadHeroImage() {
  return useMutation({
    mutationFn: ({ file, alt }: { file: File; alt: string }) =>
      csrfUpload<Image>("/admin/settings/hero-image", file, { alt }),
  });
}

/* ------------------------------------------------------------------- pages */

export function usePages() {
  return useQuery({
    queryKey: adminKeys.pages,
    queryFn: ({ signal }) => apiGet<PageDraft[]>("/admin/pages", signal),
  });
}

export function useCreatePage() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: (input: PageInput) => csrfPost<{ id: string }>("/admin/pages", input),
    onSuccess: () => invalidate(adminKeys.pages),
  });
}

export function useUpdatePage() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PageInput }) => csrfPut<void>(`/admin/pages/${id}`, input),
    onSuccess: () => invalidate(adminKeys.pages),
  });
}

export function useDeletePage() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: (id: string) => csrfDelete<void>(`/admin/pages/${id}`),
    onSuccess: () => invalidate(adminKeys.pages),
  });
}

export function useReorderPages() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: (ids: string[]) => csrfPost<void>("/admin/pages/reorder", { ids }),
    onSuccess: () => invalidate(adminKeys.pages),
  });
}

/* ---------------------------------------------------- settings + wiring */

export function useSettings() {
  return useQuery({
    queryKey: adminKeys.settings,
    queryFn: ({ signal }) => apiGet<SettingsInput>("/admin/settings", signal),
  });
}

/** The store's language tag, for anything the admin formats. `en-US` until settings load. */
export function useStoreLocale(): string {
  return useSettings().data?.locale ?? "en-US";
}

export function useUpdateSettings() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: (input: SettingsInput) => csrfPut<void>("/admin/settings", input),
    onSuccess: () => invalidate(adminKeys.settings),
  });
}

export function useEnvironment() {
  return useQuery({
    queryKey: adminKeys.environment,
    queryFn: ({ signal }) => apiGet<EnvironmentStatus>("/admin/environment", signal),
    staleTime: 60_000,
  });
}

/** Send one test email to the signed-in administrator. Not cached: the next press asks again. */
export function useSendTestEmail() {
  return useMutation({
    mutationFn: () => csrfPost<EmailTestResult>("/admin/email/test", {}),
  });
}

/** Send one test postcard to Lob's test address, and report Lob's own answer. */
export function useSendTestPostcard() {
  return useMutation({
    mutationFn: (back: Partial<PostcardBack>) => csrfPost<LobTestResult>("/admin/lob/test", back),
  });
}

export interface SweepResult {
  sent: number;
  failed: number;
  parked: number;
  skipped: string | null;
}

export interface FulfilmentStatus {
  postcards: Record<string, number>;
  hasLob: boolean;
  lobMode: "test" | "live" | null;
  /** The most recent sweep since the server started, or null. */
  lastRun: { at: number; result: SweepResult } | null;
}

export function useFulfilment() {
  return useQuery({
    queryKey: adminKeys.fulfilment,
    queryFn: ({ signal }) => apiGet<FulfilmentStatus>("/admin/fulfilment", signal),
    staleTime: 30_000,
  });
}

export function useRunFulfilment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => csrfPost<SweepResult>("/admin/fulfilment/run", {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.fulfilment });
      await queryClient.invalidateQueries({ queryKey: ["admin", "orders"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "order"] });
    },
  });
}

/* ------------------------------------------------------------------ orders */

export const ORDER_PAGE_SIZE = 25;

export function useOrders(status: OrderStatus | "all", offset: number) {
  return useQuery({
    queryKey: adminKeys.orders(status, offset),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ limit: String(ORDER_PAGE_SIZE), offset: String(offset) });
      if (status !== "all") params.set("status", status);
      return apiGet<OrderPage>(`/admin/orders?${params.toString()}`, signal);
    },
    placeholderData: (previous) => previous,
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: adminKeys.order(id ?? ""),
    queryFn: ({ signal }) => apiGet<Order>(`/admin/orders/${id ?? ""}`, signal),
    enabled: Boolean(id),
  });
}

function useOrderMutation<TInput>(run: (input: TInput) => Promise<{ order: Order }>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: run,
    onSuccess: async ({ order }) => {
      queryClient.setQueryData(adminKeys.order(order.id), order);
      await queryClient.invalidateQueries({ queryKey: ["admin", "orders"] });
      await queryClient.invalidateQueries({ queryKey: adminKeys.fulfilment });
    },
  });
}

export function useCancelOrder() {
  return useOrderMutation((id: string) =>
    csrfPost<{ order: Order; withdrawn: number }>(`/admin/orders/${id}/cancel`, {}),
  );
}

export function useRetryPostcard() {
  return useOrderMutation(({ orderId, postcardId }: { orderId: string; postcardId: string }) =>
    csrfPost<{ order: Order }>(`/admin/orders/${orderId}/postcards/${postcardId}/retry`, {}),
  );
}

export function useCancelPostcard() {
  return useOrderMutation(({ orderId, postcardId }: { orderId: string; postcardId: string }) =>
    csrfPost<{ order: Order }>(`/admin/orders/${orderId}/postcards/${postcardId}/cancel`, {}),
  );
}

/**
 * Refunds are recorded by the `charge.refunded` webhook, not by the response
 * to this call, so the order that comes back is usually still the old one.
 * Invalidate and let the refetch pick up the new figures once Stripe has
 * called us back.
 */
export function useRefundOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RefundInput }) =>
      csrfPost<{ order: Order; emailed: boolean }>(`/admin/orders/${id}/refund`, input),
    onSuccess: async ({ order }) => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.order(order.id) });
      await queryClient.invalidateQueries({ queryKey: ["admin", "orders"] });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: PasswordChangeInput) => csrfPut<void>("/admin/users/me/password", input),
  });
}
