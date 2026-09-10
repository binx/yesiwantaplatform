import { replyCardSchema, type ReplyCard } from "@shared/reply";
import type { ReactionInput } from "@shared/postcards";
import { apiGet, csrfPost } from "./api";

/** The card behind a code, from the storefront's side. */
export async function fetchReplyCard(code: string, signal?: AbortSignal): Promise<ReplyCard> {
  return replyCardSchema.parse(await apiGet<unknown>(`/r/${encodeURIComponent(code)}`, signal));
}

export async function sendReaction(code: string, input: ReactionInput): Promise<void> {
  await csrfPost<void>(`/r/${encodeURIComponent(code)}/reaction`, input);
}
