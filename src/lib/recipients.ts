import { unknownVerification, verificationSchema, type Recipient, type Verification } from "@shared/postcards";
import { csrfPost } from "./api";

/**
 * Address verification, from the storefront's side.
 *
 * The server asks Lob what USPS makes of an address and answers with a
 * verdict and, when there is one, the address in USPS's form. A failed
 * call — the limiter, a network blip — comes back as `unknown` here for the
 * same reason the server turns a Lob outage into `unknown`: a check that
 * cannot be made must not stop a sale.
 */
export async function verifyRecipient(recipient: Recipient): Promise<Verification> {
  try {
    return verificationSchema.parse(await csrfPost<unknown>("/recipients/verify", recipient));
  } catch {
    return unknownVerification;
  }
}

/** One recipient's identity in a list: the same person at the same address, however it was typed. */
export function recipientKey(recipient: Recipient): string {
  return [recipient.name, recipient.line1, recipient.line2 ?? "", recipient.city, recipient.state, recipient.postalCode.slice(0, 5)]
    .join("|")
    .toLowerCase()
    .replace(/[^a-z0-9|]/g, "");
}

export type VerificationTone = "suggest" | "warn" | "block";

export interface VerificationNote {
  tone: VerificationTone;
  title: string;
  detail: string | null;
}

/**
 * What to tell the buyer, or nothing. Null means the address goes in as
 * typed: USPS agrees with it, or could not be asked.
 */
export function describeVerification(verification: Verification): VerificationNote | null {
  switch (verification.deliverability) {
    case "unknown":
      return null;
    case "deliverable":
      return verification.changed ? { tone: "suggest", title: "USPS knows this address as:", detail: null } : null;
    case "deliverable_unnecessary_unit":
      return {
        tone: "warn",
        title: "USPS says this building doesn't need an apartment or suite number.",
        detail: "It will still be delivered. Use USPS's form of it, or keep yours.",
      };
    case "deliverable_incorrect_unit":
      return {
        tone: "warn",
        title: "USPS doesn't recognise that apartment or suite number at this building.",
        detail: "Check it if you can. Kept as it is, the card relies on the carrier knowing the building.",
      };
    case "deliverable_missing_unit":
      return {
        tone: "warn",
        title: "USPS thinks this building needs an apartment or suite number.",
        detail: "Add one if you know it. Without it the card may not be delivered.",
      };
    case "undeliverable":
      return {
        tone: "block",
        title: "USPS doesn't recognise this address.",
        detail: "Check the street number and the ZIP. The printer would refuse it after payment, so it can't go in as it is.",
      };
  }
}
