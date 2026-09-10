import { useState } from "react";
import { recipientSchema, type Recipient, type Verification } from "@shared/postcards";
import { describeVerification, verifyRecipient } from "./recipients";

/**
 * The recipient form's state, without the form: what a blank one holds, how
 * a draft is validated, and the verify-then-commit-or-ask step every form
 * that adds a recipient goes through. Kept apart from the components so the
 * component file exports only components (Vite's fast refresh wants that).
 */
export const BLANK_RECIPIENT: Recipient = { name: "", line1: "", line2: null, city: "", state: "", postalCode: "" };

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

export interface RecipientCheck {
  /** What the buyer typed, already through the schema. */
  value: Recipient;
  verification: Verification;
}

/**
 * Verify, then either commit or ask.
 *
 * `run` validates nothing — the caller has already run `validateRecipient` —
 * it asks the server what USPS makes of the address and commits straight
 * away when there is nothing to say. Otherwise it parks the decision in
 * `check` for a `VerificationNotice` to render, and one of the three
 * resolvers finishes it.
 */
export function useRecipientCheck() {
  const [check, setCheck] = useState<(RecipientCheck & { commit: (value: Recipient, verification: Verification) => void }) | null>(null);
  const [verifying, setVerifying] = useState(false);

  const run = async (value: Recipient, commit: (value: Recipient, verification: Verification) => void) => {
    setVerifying(true);
    const verification = await verifyRecipient(value);
    setVerifying(false);
    if (describeVerification(verification)) setCheck({ value, verification, commit });
    else commit(value, verification);
  };

  const useSuggested = () => {
    if (!check) return;
    const suggested = check.verification.suggested ?? check.value;
    check.commit(suggested, { deliverability: "deliverable", suggested: null, changed: false });
    setCheck(null);
  };

  const keepMine = () => {
    if (!check) return;
    // The buyer's decision: what they typed goes in, and it is not asked about again.
    check.commit(check.value, { deliverability: "deliverable", suggested: null, changed: false });
    setCheck(null);
  };

  const dismiss = () => setCheck(null);

  return { check, verifying, run, useSuggested, keepMine, dismiss };
}

