import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CollectionInput,
  EnvironmentStatus,
  PageInput,
  ProductInput,
  SettingsInput,
  ShippingTableInput,
  AdminRole,
  AdminSummary,
  InviteInput,
  PasswordChangeInput,
} from "@shared/api";
import type { ShippingRate, ShippingZone } from "@shared/shipping";
import type { Collection, Image, PageDraft, Product } from "@shared/schema";
import type { FulfilmentInput, Order, OrderStatus, RefundInput } from "@shared/orders";
import { apiGet, csrfDelete, csrfPost, csrfPut, csrfUpload } from "@/lib/api";

/**
 * Admin reads and writes.
 *
 * Every mutation invalidates both its own list and the public store query, so
 * an edit is visible on the storefront in the same tab without a reload. v1
 * generated one router Route per product from a config blob, so a product
 * added in the admin had no route at all until a full page refresh.
 */

export const adminKeys = {
  products: ["admin", "products"] as const,
  product: (slug: string) => ["admin", "product", slug] as const,
  collections: ["admin", "collections"] as const,
  pages: ["admin", "pages"] as const,
  settings: ["admin", "settings"] as const,
  environment: ["admin", "environment"] as const,
  shipping: ["admin", "shipping"] as const,
  users: ["admin", "users"] as const,
  orders: (status: OrderStatus | "all", offset: number) =>
    ["admin", "orders", status, offset] as const,
  order: (id: string) => ["admin", "order", id] as const,
};

export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  isLive: boolean;
  /** Published to Stripe under tax settings the store no longer uses. */
  needsTaxRepublish: boolean;
}

export interface OrderPage {
  orders: Order[];
  total: number;
  limit: number;
  offset: number;
}

export interface PublishResult {
  stripeProductId: string;
  pricesCreated: number;
  pricesReused: number;
  pricesArchived: number;
}

/** Anything the storefront renders is derived from these. */
const PUBLIC_KEYS: readonly (readonly unknown[])[] = [["store"], ["collections"], ["page"]];

function useInvalidate() {
  const queryClient = useQueryClient();

  return async (...keys: readonly (readonly unknown[])[]) => {
    await Promise.all(
      [...keys, ...PUBLIC_KEYS].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  };
}

/* ---------------------------------------------------------------- products */

export function useProducts() {
  return useQuery({
    queryKey: adminKeys.products,
    queryFn: ({ signal }) => apiGet<ProductSummary[]>("/admin/products", signal),
  });
}

export function useProduct(slug: string | undefined) {
  return useQuery({
    queryKey: adminKeys.product(slug ?? ""),
    queryFn: ({ signal }) => apiGet<Product>(`/admin/products/${slug ?? ""}`, signal),
    enabled: Boolean(slug),
    // The editor owns the form state once loaded; refetching under the user
    // would discard what they are typing.
    staleTime: Infinity,
    refetchOnMount: false,
  });
}

export function useCreateProduct() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: (input: ProductInput) => csrfPost<{ id: string }>("/admin/products", input),
    onSuccess: () => invalidate(adminKeys.products),
  });
}

export function useUpdateProduct() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ProductInput }) =>
      csrfPut<void>(`/admin/products/${id}`, input),
    onSuccess: () => invalidate(adminKeys.products),
  });
}

export function useDeleteProduct() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: (id: string) => csrfDelete<void>(`/admin/products/${id}`),
    onSuccess: () => invalidate(adminKeys.products),
  });
}

export function useReorderProducts() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: (ids: string[]) => csrfPost<void>("/admin/products/reorder", { ids }),
    onSuccess: () => invalidate(adminKeys.products),
  });
}

export function usePublishProduct() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: (id: string) => csrfPost<PublishResult>(`/admin/products/${id}/publish`),
    onSuccess: () => invalidate(adminKeys.products),
  });
}

/* ------------------------------------------------------------------ images */

export function useUploadImage() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: ({ productId, file, alt }: { productId: string; file: File; alt: string }) =>
      csrfUpload<Image>(`/admin/products/${productId}/images`, file, { alt }),
    onSuccess: () => invalidate(adminKeys.products),
  });
}

/**
 * Uploads a logo and returns it. Deliberately does not invalidate settings —
 * the theme editor holds the result in its unsaved form state until Save.
 */
export function useUploadLogo() {
  return useMutation({
    mutationFn: ({ file, alt }: { file: File; alt: string }) =>
      csrfUpload<Image>("/admin/settings/logo", file, { alt }),
  });
}

export function useDeleteImage() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: ({ productId, path }: { productId: string; path: string }) =>
      csrfDelete<void>(`/admin/products/${productId}/images`, { path }),
    onSuccess: () => invalidate(adminKeys.products),
  });
}

export function useUpdateImageAlt() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: ({ productId, path, alt }: { productId: string; path: string; alt: string }) =>
      csrfPut<void>(`/admin/products/${productId}/images`, { path, alt }),
    onSuccess: () => invalidate(adminKeys.products),
  });
}

export function useReorderImages() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: ({ productId, paths }: { productId: string; paths: string[] }) =>
      csrfPost<void>(`/admin/products/${productId}/images/reorder`, { paths }),
    onSuccess: () => invalidate(adminKeys.products),
  });
}

/* ------------------------------------------------------------- collections */

export function useCollections() {
  return useQuery({
    queryKey: adminKeys.collections,
    queryFn: ({ signal }) => apiGet<Collection[]>("/admin/collections", signal),
  });
}

export function useCreateCollection() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: (input: CollectionInput) => csrfPost<{ id: string }>("/admin/collections", input),
    onSuccess: () => invalidate(adminKeys.collections),
  });
}

export function useUpdateCollection() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CollectionInput }) =>
      csrfPut<void>(`/admin/collections/${id}`, input),
    onSuccess: () => invalidate(adminKeys.collections),
  });
}

export function useDeleteCollection() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: (id: string) => csrfDelete<void>(`/admin/collections/${id}`),
    onSuccess: () => invalidate(adminKeys.collections),
  });
}

export function useReorderCollections() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: (ids: string[]) => csrfPost<void>("/admin/collections/reorder", { ids }),
    onSuccess: () => invalidate(adminKeys.collections),
  });
}

/* ------------------------------------------------------------------- pages */

/**
 * Store pages.
 *
 * Bodies are Markdown in both directions. The storefront never sees this
 * shape — it gets HTML rendered and sanitised on the server — which is why the
 * editor can hold the source without shipping a parser to shoppers.
 */
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
    mutationFn: ({ id, input }: { id: string; input: PageInput }) =>
      csrfPut<void>(`/admin/pages/${id}`, input),
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

/* ---------------------------------------------------------------- shipping */

export interface ShippingTable {
  zones: ShippingZone[];
  rates: ShippingRate[];
}

export function useShipping() {
  return useQuery({
    queryKey: adminKeys.shipping,
    queryFn: ({ signal }) => apiGet<ShippingTable>("/admin/shipping", signal),
  });
}

export function useUpdateShipping() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: (input: ShippingTableInput) => csrfPut<void>("/admin/shipping", input),
    onSuccess: () => invalidate(adminKeys.shipping),
  });
}

/* ------------------------------------------------------------------ orders */

export const ORDER_PAGE_SIZE = 25;

export function useOrders(status: OrderStatus | "all", offset: number) {
  return useQuery({
    queryKey: adminKeys.orders(status, offset),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        limit: String(ORDER_PAGE_SIZE),
        offset: String(offset),
      });
      if (status !== "all") params.set("status", status);
      return apiGet<OrderPage>(`/admin/orders?${params.toString()}`, signal);
    },
    // Keeps the table on screen while paging instead of flashing a spinner.
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

/**
 * Refunds are recorded by the `charge.refunded` webhook, not by the response
 * to this call, so the order that comes back is usually still the old one.
 * Invalidate rather than write it into the cache and let the refetch pick up
 * the new figures once Stripe has called us back.
 */
export interface StaffList {
  users: AdminSummary[];
  invites: { id: string; email: string; role: AdminRole }[];
}

export function useStaff() {
  return useQuery({
    queryKey: adminKeys.users,
    queryFn: ({ signal }) => apiGet<StaffList>("/admin/users", signal),
  });
}

/**
 * Invite a colleague.
 *
 * `inviteUrl` comes back only when SMTP is not configured — it is a credential,
 * so it is returned exactly once, and only when there was no other way to get
 * it to the person it is for.
 */
export function useInviteStaff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: InviteInput) =>
      csrfPost<{ id: string; email: string; inviteUrl?: string }>("/admin/users", input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.users });
    },
  });
}

export function useRemoveStaff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => csrfDelete<void>(`/admin/users/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.users });
    },
  });
}

export function useRevokeInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => csrfDelete<void>(`/admin/users/invites/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.users });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: PasswordChangeInput) =>
      csrfPut<void>("/admin/users/me/password", input),
  });
}

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

export function useUpdateFulfilment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: FulfilmentInput }) =>
      csrfPut<{ order: Order; emailed: boolean }>(`/admin/orders/${id}`, input),
    onSuccess: async ({ order }) => {
      queryClient.setQueryData(adminKeys.order(order.id), order);
      await queryClient.invalidateQueries({ queryKey: ["admin", "orders"] });
    },
  });
}
