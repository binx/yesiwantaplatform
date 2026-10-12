import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  ArtistProfileInput,
  ArtistPublic,
  ArtistStudio,
  ArtistSummary,
  CollectInput,
  CollectResponse,
  Collection,
  Collector,
  Earnings,
  Edition,
  EditionCardsInput,
  EditionInput,
  EditionStatus,
  EditionStudio,
  EditionSummary,
  GalleryPage,
} from "@shared/platform";
import type { PostcardBack, PostcardDesign, Recipient } from "@shared/postcards";
import type { Image, Pricing } from "@shared/schema";
import { apiGet, csrfDelete, csrfPost, csrfPut, csrfUpload } from "./api";

/**
 * The platform's public reads, the collect flow, and the studio.
 *
 * Studio queries share a `["studio"]` prefix so signing out drops them all
 * in one call, and every studio mutation invalidates the prefix rather than
 * one key: the overview counts, the editions and the design list all move
 * together when a card goes into an edition.
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
  /** On sale and closed; drafts never leave the studio. */
  editions: EditionSummary[];
}

export function useArtist(slug: string | undefined): UseQueryResult<ArtistPage> {
  return useQuery({
    queryKey: ["artist", slug],
    queryFn: ({ signal }) => apiGet<ArtistPage>(`/artists/${slug ?? ""}`, signal),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });
}

export interface EditionPage {
  artist: ArtistPublic;
  edition: Edition;
}

export function useEdition(artistSlug: string | undefined, editionSlug: string | undefined): UseQueryResult<EditionPage> {
  return useQuery({
    queryKey: ["artist", artistSlug, "edition", editionSlug],
    queryFn: ({ signal }) => apiGet<EditionPage>(`/artists/${artistSlug ?? ""}/editions/${editionSlug ?? ""}`, signal),
    enabled: Boolean(artistSlug && editionSlug),
    staleTime: 60_000,
  });
}

/** The gallery: editions on sale, newest first, a page at a time. */
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

/* ---------------------------------------------------------------- collect */

export function useCollect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CollectInput) => csrfPost<CollectResponse>("/checkout/collect", input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["account"] }),
  });
}

/** The confirmation page's read: still `incomplete` until the webhook lands, so it polls. */
export function useCheckoutCollection(sessionId: string | null): UseQueryResult<Collection> {
  return useQuery({
    queryKey: ["checkout", sessionId],
    queryFn: ({ signal }) => apiGet<Collection>(`/checkout/${sessionId ?? ""}`, signal),
    enabled: Boolean(sessionId),
    refetchInterval: (query) => (query.state.data?.status === "incomplete" || !query.state.data ? 2000 : false),
  });
}

/* ------------------------------------------------------------------ studio */

export interface StudioView {
  artist: ArtistStudio;
  editionCounts: { draft: number; onSale: number; closed: number };
  earnings: { pendingCents: number; paidCents: number; currency: string };
  /** The platform's numbers, for the edition form's "each card earns you" line. */
  pricing: Pricing | null;
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

/** The wide picture across the top of the page. Stored now, saved with the profile. */
export function useUploadBanner() {
  return useMutation({
    mutationFn: ({ file, alt }: { file: File; alt: string }) => csrfUpload<Image>("/studio/banner", file, { alt }),
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

/* --------------------------------------------------------------- editions */

export function useStudioEditions(): UseQueryResult<EditionStudio[]> {
  return useQuery({
    queryKey: ["studio", "editions"],
    queryFn: ({ signal }) => apiGet<EditionStudio[]>("/studio/editions", signal),
  });
}

export function useStudioEdition(id: string | undefined): UseQueryResult<EditionStudio> {
  return useQuery({
    queryKey: ["studio", "editions", id],
    queryFn: ({ signal }) => apiGet<EditionStudio>(`/studio/editions/${id ?? ""}`, signal),
    enabled: Boolean(id),
  });
}

export function useCreateEdition() {
  const invalidate = useInvalidateStudio();
  return useMutation({
    mutationFn: (input: EditionInput) => csrfPost<EditionStudio>("/studio/editions", input),
    onSuccess: invalidate,
  });
}

/** A draft can change anything; one on sale only its title, description, banner and gallery flag. */
export function useUpdateEdition() {
  const invalidate = useInvalidateStudio();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: EditionInput }) => csrfPut<EditionStudio>(`/studio/editions/${id}`, input),
    onSuccess: invalidate,
  });
}

/** An edition's banner: stored now, saved with the edition. What visitors see in place of the cards. */
export function useUploadEditionBanner() {
  return useMutation({
    mutationFn: ({ file, alt }: { file: File; alt: string }) => csrfUpload<Image>("/studio/editions/banner", file, { alt }),
  });
}

/** A draft's cards, in order. Replaces the whole set. */
export function useSetEditionCards() {
  const invalidate = useInvalidateStudio();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: EditionCardsInput }) => csrfPut<EditionStudio>(`/studio/editions/${id}/cards`, input),
    onSuccess: invalidate,
  });
}

export function useSetEditionStatus() {
  const invalidate = useInvalidateStudio();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: EditionStatus }) => csrfPost<EditionStudio>(`/studio/editions/${id}/status`, { status }),
    onSuccess: invalidate,
  });
}

export function useDeleteEdition() {
  const invalidate = useInvalidateStudio();
  return useMutation({
    mutationFn: (id: string) => csrfDelete<void>(`/studio/editions/${id}`),
    onSuccess: invalidate,
  });
}

/* ------------------------------------------------------------- collectors */

export function useCollectors(): UseQueryResult<Collector[]> {
  return useQuery({
    queryKey: ["studio", "collectors"],
    queryFn: ({ signal }) => apiGet<Collector[]>("/studio/collectors", signal),
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
