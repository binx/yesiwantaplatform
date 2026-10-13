/**
 * Strings that must read the same wherever they appear. Import these
 * instead of retyping the sentence, so two pages cannot drift back into
 * disagreeing with each other.
 */

/** The pitch under the wordmark, four lines. No prices: those live in settings. */
export const PITCH_LINES = [
  "A real postcard in your mailbox, not another post in your feed.",
  "Artists turn their work into editions of 6 or 12 postcards.",
  "Choose how often you want them mailed: once or twice a month.",
  "Pay once, then let the mail surprise you.",
] as const;

/**
 * What pausing an artist or closing an edition means for the people who
 * already collected: nothing. Said the same way on the artist's page, the
 * edition's page, and in the studio.
 */
export const KEEPS_EVERY_CARD = "Everyone who already collected still gets every card.";

/** The pitch to an artist: the heading and the line under it, on the front page and at /how-it-works. */
export const ARTIST_PITCH = {
  heading: "Put your pictures in the mail",
  lede: "Share your art with the world and put a little delight in someone's mailbox. Your pictures become real postcards, mailed one at a time to the people who want them.",
} as const;

/** How it works for an artist, in three steps. Shown once, at /how-it-works. */
export const ARTIST_STEPS = [
  { title: "Set up your studio", text: "Tell us about yourself, then set up your art editions: 6 or 12 postcards each." },
  { title: "Collectors purchase your art", text: "Customers choose how often they want the cards mailed to them." },
  { title: "We print and post", text: "Every card goes out on its day, from our printer to their mailbox." },
] as const;
