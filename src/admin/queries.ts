import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CollectionInput,
  EnvironmentStatus,
  PageInput,
  ProductInput,
  EmailTestResult,
  SettingsInput,
  ShippingTableInput,
  AdminRole,
  AdminSummary,
  InviteInput,
  PasswordChangeInput,
  StorefrontAccessInput,
  StorefrontStatus,
} from "@shared/api";
import type { ShippingRate, ShippingZone } from "@shared/shipping";
import type {
  WebhookDeliverySummary,
  WebhookEndpointInput,
  WebhookEndpointSummary,
} from "@shared/webhooks";
import type { CollectionDraft, Image, PageDraft, Product, ProductKind } from "@shared/schema";
import type { FulfilmentInput, Order, OrderStatus, RefundInput } from "@shared/orders";
import { apiGet, csrfDelete, csrfPost, csrfPostText, csrfPut, csrfUpload } from "@/lib/api";

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
  storefront: ["admin", "storefront"] as const,
  shipping: ["admin", "shipping"] as const,
  users: ["admin", "users"] as const,
  webhooks: ["admin", "webhooks"] as const,
  webhookDeliveries: (id: string) => ["admin", "webhooks", id, "deliveries"] as const,
  orders: (status: OrderStatus | "all", offset: number) =>
    ["admin", "orders", status, offset] as const,
  order: (id: string) => ["admin", "order", id] as const,
};

export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  isLive: boolean;
  /** Live on the storefront with a variant that has no Stripe Price. */
  needsPublish: boolean;
  /** Published to Stripe under tax settings the store no longer uses. */
  needsTaxRepublish: boolean;
  /** Whether this product ships. A download-only store needs no rates. */
  kind: ProductKind;
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

/* ------------------------------------------------------- catalogue import */

/** One problem in the file, located so a merchant can go and fix it. */
export interface ImportIssue {
  row: number;
  column: string;
  message: string;
}

export interface ImportPreviewProduct {
  slug: string;
  name: string;
  action: "create" | "update";
  variants: number;
  rows: number[];
  /** False when this product has errors and would be skipped. */
  valid: boolean;
}

export interface ImportPreview {
  rows: number;
  creates: number;
  updates: number;
  errors: ImportIssue[];
  /** Errors beyond the number the server is willing to serialise. */
  errorsOmitted: number;
  products: ImportPreviewProduct[];
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
}

/** Says what the file would do. Writes nothing, so it invalidates nothing. */
export function useValidateImport() {
  return useMutation({
    mutationFn: (csv: string) =>
      csrfPostText<ImportPreview>("/admin/products/import/validate", csv, "text/csv"),
  });
}

/**
 * Applies it.
 *
 * The file is sent a second time rather than a token from the preview: the
 * server re-parses and re-validates, so nothing can be committed that has not
 * just passed the same checks.
 */
export function useCommitImport() {
  const invalidate = useInvalidate();

  return useMutation({
    mutationFn: ({ csv, skipInvalid }: { csv: string; skipInvalid: boolean }) =>
      csrfPostText<ImportResult>(
        `/admin/products/import/commit${skipInvalid ? "?skipInvalid=true" : ""}`,
        csv,
        "text/csv",
      ),
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

/** The hero image, on the same terms as the logo: uploaded now, saved on Save. */
export function useUploadHeroImage() {
  return useMutation({
    mutationFn: ({ file, alt }: { file: File; alt: string }) =>
      csrfUpload<Image>("/admin/settings/hero-image", file, { alt }),
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
    mutationFn: ({
      productId,
      path,
      alt,
      variantId,
    }: {
      productId: string;
      path: string;
      alt?: string;
      variantId?: string | null;
    }) => csrfPut<void>(`/admin/products/${productId}/images`, { path, alt, variantId }),
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
    // Drafts: the editor round-trips Markdown source, not the rendered HTML
    // the storefront receives. Same split as pages.
    queryFn: ({ signal }) => apiGet<CollectionDraft[]>("/admin/collections", signal),
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

/**
 * Uploads a cover and returns it. Like the logo, it deliberately does not
 * invalidate anything: the image exists on disk, but no collection points at
 * it until the caller saves one.
 */
export function useUploadCollectionCover() {
  return useMutation({
    mutationFn: ({ id, file, alt }: { id: string; file: File; alt: string }) =>
      csrfUpload<Image>(`/admin/collections/${id}/cover`, file, { alt }),
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

/**
 * The store's language tag, for anything the admin formats.
 *
 * A hook of its own because seven pages need it and none of them should each
 * decide what to do when settings have not loaded — the answer is `en-US`,
 * which is what the admin formatted as before stores had a locale, so a table
 * rendered during that first moment does not shift once it lands.
 */
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

/**
 * Send one test email to the signed-in administrator.
 *
 * Not a cache write, so nothing is invalidated: the answer is about the SMTP
 * transport at this moment, and the next press should ask again rather than
 * read a remembered result.
 */
export function useSendTestEmail() {
  return useMutation({
    mutationFn: () => csrfPost<EmailTestResult>("/admin/email/test", {}),
  });
}

/* -------------------------------------------------------- storefront access */

export function useStorefrontStatus() {
  return useQuery({
    queryKey: adminKeys.storefront,
    queryFn: ({ signal }) => apiGet<StorefrontStatus>("/admin/storefront", signal),
  });
}

export function useUpdateStorefrontAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: StorefrontAccessInput) => csrfPut<void>("/admin/storefront", input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.storefront });
    },
  });
}

export function useSetStorefrontPassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (password: string) => csrfPut<void>("/admin/storefront/password", { password }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.storefront });
    },
  });
}

export function useClearStorefrontPassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => csrfDelete<void>("/admin/storefront/password"),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.storefront });
    },
  });
}

/** The full URL comes back exactly once, on creation — see the route. */
export function useCreateShareLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => csrfPost<{ url: string }>("/admin/storefront/share-link", {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.storefront });
    },
  });
}

export function useRevokeShareLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => csrfDelete<void>("/admin/storefront/share-link"),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.storefront });
    },
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

/* ------------------------------------------------------- outbound webhooks */

/**
 * Webhook endpoints — see docs/tasks/14-outbound-webhooks.md.
 *
 * These deliberately do *not* invalidate the public store keys the way product
 * and page mutations do: nothing here changes what a shopper sees, and the
 * blanket invalidation in `useInvalidate` would refetch the whole storefront
 * every time a merchant ticked an event type.
 */
export function useWebhookEndpoints() {
  return useQuery({
    queryKey: adminKeys.webhooks,
    queryFn: ({ signal }) =>
      apiGet<{ endpoints: WebhookEndpointSummary[] }>("/admin/webhooks", signal),
  });
}

export function useWebhookDeliveries(endpointId: string | null) {
  return useQuery({
    queryKey: adminKeys.webhookDeliveries(endpointId ?? ""),
    queryFn: ({ signal }) =>
      apiGet<{ deliveries: WebhookDeliverySummary[] }>(
        `/admin/webhooks/${endpointId!}/deliveries`,
        signal,
      ),
    enabled: Boolean(endpointId),
  });
}

/** The secret comes back here and nowhere else, ever. */
export function useCreateWebhookEndpoint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: WebhookEndpointInput) =>
      csrfPost<{ endpoint: WebhookEndpointSummary; secret: string }>("/admin/webhooks", input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.webhooks });
    },
  });
}

export function useUpdateWebhookEndpoint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: WebhookEndpointInput }) =>
      csrfPut<{ endpoint: WebhookEndpointSummary }>(`/admin/webhooks/${id}`, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.webhooks });
    },
  });
}

export function useRollWebhookSecret() {
  return useMutation({
    mutationFn: (id: string) => csrfPost<{ secret: string }>(`/admin/webhooks/${id}/secret`, {}),
  });
}

export function useDeleteWebhookEndpoint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => csrfDelete<void>(`/admin/webhooks/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.webhooks });
    },
  });
}

export function useRedeliverWebhook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ deliveryId }: { endpointId: string; deliveryId: string }) =>
      csrfPost<{ delivery: WebhookDeliverySummary }>(
        `/admin/webhooks/deliveries/${deliveryId}/redeliver`,
        {},
      ),
    onSuccess: async (_result, { endpointId }) => {
      await queryClient.invalidateQueries({
        queryKey: adminKeys.webhookDeliveries(endpointId),
      });
    },
  });
}
