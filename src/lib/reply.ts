import { replyCardSchema, type ReplyCard } from "@shared/reply";
import { apiGet } from "./api";

/** The card behind a code, from the storefront's side. */
export async function fetchReplyCard(code: string, signal?: AbortSignal): Promise<ReplyCard> {
  return replyCardSchema.parse(await apiGet<unknown>(`/r/${encodeURIComponent(code)}`, signal));
}


