import { useMutation, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { postcardDesignSchema, type Crop, type PostcardBack, type PostcardDesign, type Orientation } from "@shared/postcards";
import { z } from "zod";
import { ApiError, apiGet } from "./api";

/**
 * Postcard designs, from the storefront's side.
 *
 * A design is saved the moment the buyer presses Save — the image goes up,
 * the print file is made, and an id comes back. The cart holds only that id,
 * and re-fetches the thumbnail and the message whenever it renders.
 */

export const designsQueryKey = (ids: string[]) => ["designs", [...ids].sort()] as const;

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Fall through.
  }
  return `Request failed (HTTP ${response.status}).`;
}

export interface SaveDesignInput {
  file: File;
  orientation: Orientation;
  back: PostcardBack;
  /** Where the photo sits in the frame; the server crops the print file the same way. */
  crop: Crop;
}

/**
 * Upload a design. Multipart, and a plain public POST — like checkout, this
 * is something any visitor may do, so it carries no CSRF token and creates
 * no session row.
 */
export async function saveDesign(input: SaveDesignInput): Promise<PostcardDesign> {
  const form = new FormData();
  form.append("file", input.file);
  form.append("orientation", input.orientation);
  form.append("back", JSON.stringify(input.back));
  form.append("crop", JSON.stringify(input.crop));

  const response = await fetch("/api/designs", {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    body: form,
  });

  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return postcardDesignSchema.parse(await response.json());
}

export function useSaveDesign() {
  return useMutation({ mutationFn: saveDesign });
}

/**
 * The designs behind a set of ids — the cart's, or an order's.
 *
 * A missing id is not an error: the design was cleaned up, and the caller
 * shows the line as unavailable rather than failing the whole cart.
 */
export function useDesigns(ids: string[]): UseQueryResult<Map<string, PostcardDesign>> {
  const unique = [...new Set(ids)];

  return useQuery({
    queryKey: designsQueryKey(unique),
    queryFn: async ({ signal }) => {
      if (unique.length === 0) return new Map<string, PostcardDesign>();
      const designs = z
        .array(postcardDesignSchema)
        .parse(await apiGet<unknown>(`/designs?ids=${encodeURIComponent(unique.join(","))}`, signal));
      return new Map(designs.map((design) => [design.id, design]));
    },
    staleTime: 5 * 60 * 1000,
  });
}
