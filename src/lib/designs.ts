import { useMutation, useQueryClient } from "@tanstack/react-query";
import { postcardDesignSchema, type Crop, type PostcardBack, type PostcardDesign, type Orientation } from "@shared/postcards";
import { ApiError, csrfUpload } from "./api";

/**
 * Saving a design from the studio.
 *
 * The file goes up once, with the back and the crop, and comes back as a
 * design id the queue carries from there. The studio is a signed-in
 * surface, so the upload carries the session's CSRF token like every other
 * studio write.
 */

export interface SaveDesignInput {
  file: File;
  orientation: Orientation;
  back: PostcardBack;
  /** Where the photo sits in the frame; the server crops the print file the same way. */
  crop: Crop;
}

export async function saveDesign(input: SaveDesignInput): Promise<PostcardDesign> {
  const raw = await csrfUpload<unknown>("/studio/designs", input.file, {
    orientation: input.orientation,
    back: JSON.stringify(input.back),
    crop: JSON.stringify(input.crop),
  });
  const parsed = postcardDesignSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("The saved design could not be read.", 500);
  return parsed.data;
}

export function useSaveDesign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveDesign,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["studio"] }),
  });
}
