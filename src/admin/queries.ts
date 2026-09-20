import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EnvironmentStatus, PageInput, EmailTestResult, LobTestResult, SettingsInput, PasswordChangeInput } from "@shared/api";
import type { Image, PageDraft } from "@shared/schema";
import type { ArtistPublic, ArtistStatus, Mailing, Order, Payout, PayoutStatus, Subscription } from "@shared/platform";
import type { Postcard, PostcardBack } from "@shared/postcards";
import { apiGet, csrfDelete, csrfPost, csrfPut, csrfUpload } from "@/lib/api";

/**
 * Admin reads and writes.
 *
 * Every mutation invalidates both its own list and the public store query, so
 * an edit is visible on the site in the same tab without a reload.
 */

export const adminKeys = {
  pages: ["admin", "pages"] as const,
  settings: ["admin", "settings"] as const,
  environment: ["admin", "environment"] as const,
  overview: ["admin", "overview"] as const,
  artists: ["admin", "artists"] as const,
  artist: (id: string) => ["admin", "artist", id] as const,
  mailings: ["admin", "mailings"] as const,
  mailing: (id: string) => ["admin", "mailing", id] as const,
  errors: ["admin", "postcard-errors"] as const,
  payouts: ["admin", "payouts"] as const,
  customers: ["admin", "customers"] as const,
  subscriptions: ["admin", "subscriptions"] as const,
  orders: ["admin", "orders"] as const,
};

/** Anything the site renders is derived from these. */
const PUBLIC_KEYS: readonly (readonly unknown[])[] = [["store"], ["page"], ["artists"], ["artist"], ["gallery"]];

function useInvalidate() {
  const queryClient = useQueryClient();
  return async (...keys: readonly (readonly unknown[])[]) => {
    await Promise.all([...keys, ...PUBLIC_KEYS].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  };
}

/* ------------------------------------------------------------------ images */

export function useUploadLogo() {
  return useMutation({
    mutationFn: ({ file, alt }: { file: File; alt: string }) => csrfUpload<Image>("/admin/settings/logo", file, { alt }),
  });
}

export function useUploadHeroImage() {
  return useMutation({
    mutationFn: ({ file, alt }: { file: File; alt: string }) => csrfUpload<Image>("/admin/settings/hero-image", file, { alt }),
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

/** The platform's language tag, for anything the admin formats. `en-US` until settings load. */
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

export function useSendTestEmail() {
  return useMutation({ mutationFn: () => csrfPost<EmailTestResult>("/admin/email/test", {}) });
}

export function useSendTestPostcard() {
  return useMutation({ mutationFn: (back: Partial<PostcardBack>) => csrfPost<LobTestResult>("/admin/lob/test", back) });
}

/* ---------------------------------------------------------------- overview */

export interface SweepResult {
  sent: number;
  failed: number;
  parked: number;
  skipped: string | null;
}

export interface PayoutSweepResult {
  paid: number;
  failed: number;
  deferred: number;
  skipped: string | null;
}

export interface Overview {
  artists: Record<string, number>;
  subscriptions: Record<string, number>;
  mailings: Record<string, number>;
  postcards: Record<string, number>;
  /** Cents, by payout status. */
  payouts: Record<string, number>;
  revenueCents: number;
  currency: string;
  hasLob: boolean;
  lobMode: "test" | "live" | null;
  lastSweep: { at: number; result: SweepResult } | null;
  lastPayoutSweep: { at: number; result: PayoutSweepResult } | null;
}

export function useOverview() {
  return useQuery({
    queryKey: adminKeys.overview,
    queryFn: ({ signal }) => apiGet<Overview>("/admin/overview", signal),
    staleTime: 30_000,
  });
}

function useInvalidateOperations() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin"] });
  };
}

export function useRunFulfilment() {
  const invalidate = useInvalidateOperations();
  return useMutation({
    mutationFn: () => csrfPost<SweepResult & { mailings: { mailed: number; postcards: number } }>("/admin/fulfilment/run", {}),
    onSuccess: invalidate,
  });
}

export function useRunPayouts() {
  const invalidate = useInvalidateOperations();
  return useMutation({
    mutationFn: () => csrfPost<PayoutSweepResult>("/admin/payouts/run", {}),
    onSuccess: invalidate,
  });
}

/* ----------------------------------------------------------------- artists */

export interface AdminArtist extends ArtistPublic {
  payoutsEnabled: boolean;
  hasStripeAccount: boolean;
  customerId: string;
}

export function useAdminArtists(status?: ArtistStatus) {
  return useQuery({
    queryKey: [...adminKeys.artists, status ?? "all"],
    queryFn: ({ signal }) => apiGet<{ artists: AdminArtist[]; total: number }>(`/admin/artists${status ? `?status=${status}` : ""}`, signal),
  });
}

export interface AdminArtistDetail {
  artist: AdminArtist & { bio: string; stripeAccountId: string | null };
  mailings: Mailing[];
  subscriptions: (Subscription & { customerId?: string })[];
}

export function useAdminArtist(id: string | undefined) {
  return useQuery({
    queryKey: adminKeys.artist(id ?? ""),
    queryFn: ({ signal }) => apiGet<AdminArtistDetail>(`/admin/artists/${id ?? ""}`, signal),
    enabled: Boolean(id),
  });
}

export function useSetAdminArtistStatus() {
  const invalidate = useInvalidateOperations();
  const invalidatePublic = useInvalidate();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ArtistStatus }) => csrfPost<void>(`/admin/artists/${id}/status`, { status }),
    onSuccess: async () => {
      await invalidate();
      await invalidatePublic();
    },
  });
}

/* ---------------------------------------------------------------- mailings */

export interface AdminMailing extends Mailing {
  artist: { id: string; slug: string; name: string } | null;
}

export function useAdminMailings(status?: string) {
  return useQuery({
    queryKey: [...adminKeys.mailings, status ?? "all"],
    queryFn: ({ signal }) => apiGet<{ mailings: AdminMailing[]; total: number }>(`/admin/mailings?limit=100${status ? `&status=${status}` : ""}`, signal),
  });
}

export interface AdminPostcard extends Postcard {
  mailingId: string;
  artistId: string;
  createdAt: number;
}

export function useAdminMailing(id: string | undefined) {
  return useQuery({
    queryKey: adminKeys.mailing(id ?? ""),
    queryFn: ({ signal }) => apiGet<{ mailing: Mailing; artist: { id: string; slug: string; name: string } | null; postcards: AdminPostcard[] }>(`/admin/mailings/${id ?? ""}`, signal),
    enabled: Boolean(id),
  });
}

export function usePostcardErrors() {
  return useQuery({
    queryKey: adminKeys.errors,
    queryFn: ({ signal }) => apiGet<AdminPostcard[]>("/admin/postcards/errors", signal),
  });
}

export function useRetryPostcard() {
  const invalidate = useInvalidateOperations();
  return useMutation({
    mutationFn: (id: string) => csrfPost<{ postcard: AdminPostcard }>(`/admin/postcards/${id}/retry`, {}),
    onSuccess: invalidate,
  });
}

export function useCancelPostcard() {
  const invalidate = useInvalidateOperations();
  return useMutation({
    mutationFn: (id: string) => csrfPost<{ postcard: AdminPostcard }>(`/admin/postcards/${id}/cancel`, {}),
    onSuccess: invalidate,
  });
}

/* ----------------------------------------------------------------- payouts */

export interface AdminPayout extends Payout {
  artist: { id: string; slug: string; name: string; payoutsEnabled: boolean } | null;
}

export function useAdminPayouts(status?: PayoutStatus) {
  return useQuery({
    queryKey: [...adminKeys.payouts, status ?? "all"],
    queryFn: ({ signal }) => apiGet<{ payouts: AdminPayout[]; total: number; totals: Record<string, number> }>(`/admin/payouts?limit=100${status ? `&status=${status}` : ""}`, signal),
  });
}

export function useRetryPayout() {
  const invalidate = useInvalidateOperations();
  return useMutation({
    mutationFn: (id: string) => csrfPost<void>(`/admin/payouts/${id}/retry`, {}),
    onSuccess: invalidate,
  });
}

/* --------------------------------------------------------------- customers */

export interface AdminCustomer {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  createdAt: number;
  artistSlug: string | null;
  activeSubscriptions: number;
}

export function useAdminCustomers() {
  return useQuery({
    queryKey: adminKeys.customers,
    queryFn: ({ signal }) => apiGet<AdminCustomer[]>("/admin/customers", signal),
  });
}

export function useAdminSubscriptions() {
  return useQuery({
    queryKey: adminKeys.subscriptions,
    queryFn: ({ signal }) => apiGet<{ subscriptions: (Subscription & { customerId: string })[]; total: number }>("/admin/subscriptions?limit=100", signal),
  });
}

export function useAdminOrders() {
  return useQuery({
    queryKey: adminKeys.orders,
    queryFn: ({ signal }) => apiGet<{ orders: (Order & { customerId: string })[]; total: number }>("/admin/orders?limit=100", signal),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: PasswordChangeInput) => csrfPut<void>("/admin/users/me/password", input),
  });
}
