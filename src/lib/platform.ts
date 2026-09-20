import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  ArtistProfileInput,
  ArtistPublic,
  ArtistStudio,
  ArtistSummary,
  Earnings,
  GalleryCard,
  GalleryPage,
  Mailing,
  MailingInput,
  MailingUpdateInput,
  SubscribeInput,
  SubscribeResponse,
  Subscriber,
  Subscription,
} from "@shared/platform";
import type { Postcard, PostcardBack, PostcardDesign, Recipient } from "@shared/postcards";
import type { Image, Pricing } from "@shared/schema";
import { apiGet, csrfDelete, csrfPost, csrfPut, csrfUpload } from "./api";

/**
 * The platform's public reads, the subscribe flow, and the studio.
 *
 * Studio queries share a `["studio"]` prefix so signing out drops them all
 * in one call, and every studio mutation invalidates the prefix rather than
 * one key: the overview counts, the queue and the design list all move
 * together when a card is queued.
 */

/* ----------------------------------------------------------------- public */

export function useArtists(): UseQueryResult<ArtistSummary[]> {
  return useQuery({
    queryKey: ["artists"],
    queryFn: ({ signal }) => apiGet<ArtistSummary[]>("/artists", signal),
    staleTime: 60_000,
  });
}

export interface ArtistPage {
  artist: ArtistPublic;
  recent: GalleryCard[];
}

export function useArtist(slug: string | undefined): UseQueryResult<ArtistPage> {
  return useQuery({
    queryKey: ["artist", slug],
    queryFn: ({ signal }) => apiGet<ArtistPage>(`/artists/${slug ?? ""}`, signal),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });
}

export function useGallery(limit = 24) {
  return useInfiniteQuery({
    queryKey: ["gallery", limit],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (pageParam) params.set("cursor", pageParam);
      return apiGet<GalleryPage>(`/gallery?${params.toString()}`, signal);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 60_000,
  });
}

/* -------------------------------------------------------------- subscribe */

export function useSubscribe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SubscribeInput) => csrfPost<SubscribeResponse>("/checkout/subscribe", input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["account"] }),
  });
}

/** The confirmation page's read: still `incomplete` until the webhook lands, so it polls. */
export function useCheckoutSubscription(sessionId: string | null): UseQueryResult<Subscription> {
  return useQuery({
    queryKey: ["checkout", sessionId],
    queryFn: ({ signal }) => apiGet<Subscription>(`/checkout/${sessionId ?? ""}`, signal),
    enabled: Boolean(sessionId),
    refetchInterval: (query) => (query.state.data?.status === "incomplete" || !query.state.data ? 2000 : false),
  });
}

/* ------------------------------------------------------------------ studio */

export interface StudioView {
  artist: ArtistStudio;
  queuedCount: number;
  nextQueued: string | null;
  nextMailDate: string;
  earnings: { pendingCents: number; paidCents: number; currency: string };
  pricing: Pricing | null;
  shareCents: number | null;
}

export const studioQueryKey = ["studio"] as const;

/** Null when the signed-in person has no artist page yet; the API says so with 404 + `needsArtist`. */
export function useStudio(enabled = true): UseQueryResult<StudioView | null> {
  return useQuery({
    queryKey: studioQueryKey,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/studio", { credentials: "same-origin", headers: { accept: "application/json" }, ...(signal ? { signal } : {}) });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Could not load the studio (HTTP ${response.status}).`);
      return (await response.json()) as StudioView;
    },
    enabled,
    retry: false,
  });
}

function useInvalidateStudio() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: studioQueryKey });
    await queryClient.invalidateQueries({ queryKey: ["account"] });
    await queryClient.invalidateQueries({ queryKey: ["artists"] });
    await queryClient.invalidateQueries({ queryKey: ["artist"] });
  };
}

export function useCreateArtist() {
  const invalidate = useInvalidateStudio();
  return useMutation({
    mutationFn: (input: ArtistProfileInput) => csrfPost<StudioView>("/studio", input),
    onSuccess: invalidate,
  });
}

export function useUpdateProfile() {
  const invalidate = useInvalidateStudio();
  return useMutation({
    mutationFn: (input: ArtistProfileInput) => csrfPut<StudioView>("/studio/profile", input),
    onSuccess: invalidate,
  });
}

export function useSetArtistStatus() {
  const invalidate = useInvalidateStudio();
  return useMutation({
    mutationFn: (status: "live" | "paused") => csrfPost<StudioView>("/studio/status", { status }),
    onSuccess: invalidate,
  });
}

export function useUploadAvatar() {
  return useMutation({
    mutationFn: ({ file, alt }: { file: File; alt: string }) => csrfUpload<Image>("/studio/avatar", file, { alt }),
  });
}

export function useSlugAvailable(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ["studio", "slug", slug],
    queryFn: ({ signal }) => apiGet<{ available: boolean }>(`/studio/slug/${encodeURIComponent(slug)}`, signal),
    enabled: enabled && slug.length >= 3,
    staleTime: 10_000,
  });
}

/* ---------------------------------------------------------------- designs */

export function useStudioDesigns(): UseQueryResult<PostcardDesign[]> {
  return useQuery({
    queryKey: ["studio", "designs"],
    queryFn: ({ signal }) => apiGet<PostcardDesign[]>("/studio/designs", signal),
  });
}

export function useUpdateDesignBack() {
  const invalidate = useInvalidateStudio();
  return useMutation({
    mutationFn: ({ id, back }: { id: string; back: PostcardBack }) => csrfPut<PostcardDesign>(`/studio/designs/${id}`, back),
    onSuccess: invalidate,
  });
}

export function useDeleteDesign() {
  const invalidate = useInvalidateStudio();
  return useMutation({
    mutationFn: (id: string) => csrfDelete<void>(`/studio/designs/${id}`),
    onSuccess: invalidate,
  });
}

/* --------------------------------------------------------------- mailings */

export interface QueueView {
  mailings: Mailing[];
  nextMailDate: string;
}

export function useStudioMailings(): UseQueryResult<QueueView> {
  return useQuery({
    queryKey: ["studio", "mailings"],
    queryFn: ({ signal }) => apiGet<QueueView>("/studio/mailings", signal),
  });
}

export function useQueueMailing() {
  const invalidate = useInvalidateStudio();
  return useMutation({
    mutationFn: (input: MailingInput) => csrfPost<Mailing>("/studio/mailings", input),
    onSuccess: invalidate,
  });
}

export function useUpdateMailing() {
  const invalidate = useInvalidateStudio();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MailingUpdateInput }) => csrfPut<Mailing>(`/studio/mailings/${id}`, input),
    onSuccess: invalidate,
  });
}

export function useCancelMailing() {
  const invalidate = useInvalidateStudio();
  return useMutation({
    mutationFn: (id: string) => csrfDelete<void>(`/studio/mailings/${id}`),
    onSuccess: invalidate,
  });
}

/** The cards of one mailing, as the artist may see them: a name and a town each. */
export function useMailingPostcards(mailingId: string | null): UseQueryResult<Postcard[]> {
  return useQuery({
    queryKey: ["studio", "mailing-postcards", mailingId],
    queryFn: ({ signal }) => apiGet<Postcard[]>(`/studio/mailings/${mailingId ?? ""}/postcards`, signal),
    enabled: Boolean(mailingId),
  });
}

/* ------------------------------------------------------------ subscribers */

export function useSubscribers(): UseQueryResult<Subscriber[]> {
  return useQuery({
    queryKey: ["studio", "subscribers"],
    queryFn: ({ signal }) => apiGet<Subscriber[]>("/studio/subscribers", signal),
  });
}

/* --------------------------------------------------------------- earnings */

export function useEarnings(): UseQueryResult<Earnings> {
  return useQuery({
    queryKey: ["studio", "earnings"],
    queryFn: ({ signal }) => apiGet<Earnings>("/studio/earnings", signal),
  });
}

export function useStartOnboarding() {
  return useMutation({
    mutationFn: () => csrfPost<{ url: string }>("/studio/payouts/onboard", {}),
  });
}

export function useRefreshPayoutStatus() {
  const invalidate = useInvalidateStudio();
  return useMutation({
    mutationFn: () => csrfPost<{ payoutsEnabled: boolean }>("/studio/payouts/refresh", {}),
    onSuccess: invalidate,
  });
}

/** A blank address, for the forms. */
export const BLANK_ADDRESS: Recipient = { name: "", line1: "", line2: null, city: "", state: "", postalCode: "", country: "US" };
