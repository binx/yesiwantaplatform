import { recipientSchema, type Recipient } from "@shared/postcards";

/**
 * The address form's state, without the form: what a blank one holds and
 * how a draft is validated. Kept apart from the components so the component
 * file exports only components (Vite's fast refresh wants that).
 */
export const BLANK_RECIPIENT: Recipient = { name: "", line1: "", line2: null, city: "", state: "", postalCode: "", country: "US" };

export type RecipientErrors = Partial<Record<keyof Recipient, string>>;

export function validateRecipient(draft: Recipient): { ok: true; value: Recipient } | { ok: false; errors: RecipientErrors } {
  const parsed = recipientSchema.safeParse({ ...draft, line2: draft.line2?.trim() ? draft.line2 : null });
  if (parsed.success) return { ok: true, value: parsed.data };

  const errors: RecipientErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof Recipient | undefined;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}
