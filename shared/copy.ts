/**
 * Strings that must read the same wherever they appear. Import these
 * instead of retyping the sentence, so two pages cannot drift back into
 * disagreeing with each other.
 */

/** No promised day: how long delivery takes after a card is mailed. */
export const DELIVERY_ESTIMATE =
  "Most cards arrive within a week of their mail date — a couple of days when the address is near the printer, longer when it isn't.";

/** The pitch under the wordmark, four lines. No prices: those live in settings. */
export const PITCH_LINES = [
  "A real postcard in your mailbox, not another post in your feed.",
  "Artists turn their work into editions of 6 or 12 postcards.",
  "Choose how often you want them delivered: once or twice a month.",
  "Pay once, then let the mail surprise you.",
] as const;
