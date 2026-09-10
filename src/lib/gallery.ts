import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { galleryDetailSchema, galleryPageSchema, type GalleryDetail, type GalleryPage } from "@shared/gallery";
import { postcardDesignSchema, type PostcardDesign } from "@shared/postcards";
import { apiGet, csrfDelete, csrfPost } from "./api";

/** The customer's gallery, from the storefront's side. */
export const galleryQueryKey = ["account", "designs"] as const;

export function useGallery(limit = 24) {
  return useInfiniteQuery({
    queryKey: [...galleryQueryKey, limit],
    queryFn: async ({ pageParam, signal }) =>
      galleryPageSchema.parse(await apiGet<unknown>(`/account/designs?limit=${limit}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`, signal)),
    initialPageParam: "",
    getNextPageParam: (page: GalleryPage) => page.nextCursor ?? undefined,
  });
}

export function useGalleryDesign(id: string | undefined): UseQueryResult<GalleryDetail> {
  return useQuery({
    queryKey: [...galleryQueryKey, "one", id],
    queryFn: async ({ signal }) => galleryDetailSchema.parse(await apiGet<unknown>(`/account/designs/${id ?? ""}`, signal)),
    enabled: Boolean(id),
  });
}

/** "Send again": a fresh copy the designer can pick up. */
export function useDuplicateDesign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<PostcardDesign> => postcardDesignSchema.parse(await csrfPost<unknown>(`/account/designs/${id}/duplicate`, {})),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: galleryQueryKey }),
  });
}

export function useDeleteDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => csrfDelete<void>(`/account/designs/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: galleryQueryKey }),
  });
}
