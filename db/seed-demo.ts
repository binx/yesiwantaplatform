import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { artistProfileInputSchema, editionInputSchema, type ArtistProfileInput, type EditionInput } from "../shared/platform.js";
import { PRINT_SIZES, postcardBackSchema, type Orientation, type PostcardBack } from "../shared/postcards.js";
import { EmailTakenError, countAdmins, createAdmin, createCustomer } from "../server/auth.js";
import { storeImage, storePostcardDesign } from "../server/uploads.js";
import { createArtist, findArtistBySlug, setArtistStatus } from "./artists-repository.js";
import { getDatabase } from "./client.js";
import { createDesign } from "./designs-repository.js";
import { createEdition, replaceEditionCards, setEditionStatus, updateDraftEdition } from "./editions-repository.js";
import { runMigrations } from "./migrate.js";
import { nowFor } from "./repository.js";
import { seedIfEmpty } from "./seed.js";

/**
 * `npm run db:seed:demo` — a platform with something on it.
 *
 * Two artists, live, with every card drawn here as an SVG and pushed through
 * the same upload pipeline a real studio uses, so the gallery, the artist
 * pages and the edition pages have real print files and thumbnails behind
 * them. One artist has two editions on sale, the other one; nothing has been
 * bought, so the studio's collectors and earnings pages stay empty.
 *
 * Re-running is harmless: an artist whose address is already taken is left
 * alone. The accounts sign in with DEMO_PASSWORD (see below), which is
 * printed at the end so the studio can be opened as either of them.
 */

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "postcards-demo-password";

interface DemoCard {
  title: string;
  back: Partial<PostcardBack>;
  /** The SVG of the front, at print size. */
  front: (width: number, height: number) => string;
}

interface DemoEdition {
  input: Omit<EditionInput, "banner">;
  bannerAlt: string;
  banner: (width: number, height: number) => string;
  cards: DemoCard[];
}

interface DemoArtist {
  email: string;
  profile: Omit<ArtistProfileInput, "avatar" | "banner">;
  avatarAlt: string;
  avatar: (size: number) => string;
  bannerAlt: string;
  banner: (width: number, height: number) => string;
  orientation: Orientation;
  editions: DemoEdition[];
}

/* ------------------------------------------------------------------- drawing */

const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A seeded pseudo-random so every run draws the same cards. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** June's skies: bands of colour, a sun or moon, a dark horizon, the title set small in the corner. */
function sky(title: string, top: string, bottom: string, sun: string, ground: string, seed: number) {
  return (width: number, height: number): string => {
    const next = random(seed);
    const horizon = height * (0.62 + next() * 0.18);
    const sunX = width * (0.2 + next() * 0.6);
    const sunY = horizon - height * (0.08 + next() * 0.3);
    const sunR = height * (0.06 + next() * 0.08);
    const clouds = Array.from({ length: 3 + Math.floor(next() * 4) }, () => {
      const cx = width * next();
      const cy = horizon * (0.15 + next() * 0.6);
      const rx = width * (0.08 + next() * 0.14);
      return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${rx * 0.28}" fill="#ffffff" opacity="${(0.25 + next() * 0.3).toFixed(2)}"/>`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>
  ${clouds}
  <circle cx="${sunX}" cy="${sunY}" r="${sunR}" fill="${sun}"/>
  <rect y="${horizon}" width="${width}" height="${height - horizon}" fill="${ground}"/>
  <text x="${width * 0.04}" y="${height * 0.95}" font-family="Georgia, serif" font-size="${height * 0.045}" fill="#fbf6ec" opacity="0.9">${escape(title)}</text>
</svg>`;
  };
}

/** Tomás's risograph creatures: two inks on cream, overlapping where they meet. */
function creature(title: string, inkA: string, inkB: string, seed: number) {
  return (width: number, height: number): string => {
    const next = random(seed);
    const cx = width / 2;
    const cy = height * 0.48;
    const body = Math.min(width, height) * (0.28 + next() * 0.08);
    const headY = cy - body * (0.9 + next() * 0.3);
    const headR = body * (0.45 + next() * 0.15);
    const eyeOffset = headR * 0.35;
    const ears = next() > 0.5
      ? `<polygon points="${cx - headR * 0.9},${headY - headR * 0.3} ${cx - headR * 0.4},${headY - headR * 1.4} ${cx - headR * 0.1},${headY - headR * 0.6}" fill="${inkB}"/>
         <polygon points="${cx + headR * 0.9},${headY - headR * 0.3} ${cx + headR * 0.4},${headY - headR * 1.4} ${cx + headR * 0.1},${headY - headR * 0.6}" fill="${inkB}"/>`
      : `<circle cx="${cx - headR * 0.8}" cy="${headY - headR * 0.7}" r="${headR * 0.35}" fill="${inkB}"/>
         <circle cx="${cx + headR * 0.8}" cy="${headY - headR * 0.7}" r="${headR * 0.35}" fill="${inkB}"/>`;
    const speckles = Array.from({ length: 400 }, () => {
      return `<circle cx="${width * next()}" cy="${height * next()}" r="${1 + next() * 2}" fill="${next() > 0.5 ? inkA : inkB}" opacity="0.35"/>`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="#f6efe0"/>
  <g style="mix-blend-mode: multiply">
    ${speckles}
    <ellipse cx="${cx}" cy="${cy + body * 0.2}" rx="${body}" ry="${body * 1.1}" fill="${inkA}" opacity="0.9"/>
    ${ears}
    <circle cx="${cx}" cy="${headY}" r="${headR}" fill="${inkB}" opacity="0.9"/>
    <circle cx="${cx - eyeOffset}" cy="${headY}" r="${headR * 0.12}" fill="#f6efe0"/>
    <circle cx="${cx + eyeOffset}" cy="${headY}" r="${headR * 0.12}" fill="#f6efe0"/>
    <circle cx="${cx}" cy="${cy + body * 1.5}" r="${body * 0.5}" fill="${inkA}" opacity="0.5"/>
  </g>
  <text x="${width / 2}" y="${height * 0.93}" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="${height * 0.04}" text-anchor="middle" letter-spacing="4" fill="${inkA}">${escape(title.toUpperCase())}</text>
</svg>`;
  };
}

/** A banner: the edition's title over a wash of its colours. */
function banner(title: string, line: string, left: string, right: string, text: string) {
  return (width: number, height: number): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${left}"/><stop offset="1" stop-color="${right}"/></linearGradient></defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>
  <circle cx="${width * 0.8}" cy="${height * 0.3}" r="${height * 0.5}" fill="#ffffff" opacity="0.12"/>
  <circle cx="${width * 0.15}" cy="${height * 0.85}" r="${height * 0.35}" fill="#000000" opacity="0.08"/>
  <text x="${width * 0.07}" y="${height * 0.5}" font-family="Georgia, serif" font-size="${height * 0.15}" fill="${text}">${escape(title)}</text>
  <text x="${width * 0.07}" y="${height * 0.64}" font-family="Georgia, serif" font-style="italic" font-size="${height * 0.06}" fill="${text}" opacity="0.85">${escape(line)}</text>
</svg>`;
}

/** An avatar: initials on a colour. */
function avatar(initials: string, background: string, text: string) {
  return (size: number): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" fill="${background}"/>
  <circle cx="${size * 0.7}" cy="${size * 0.25}" r="${size * 0.3}" fill="#ffffff" opacity="0.15"/>
  <text x="${size / 2}" y="${size * 0.62}" font-family="Georgia, serif" font-size="${size * 0.38}" text-anchor="middle" fill="${text}">${escape(initials)}</text>
</svg>`;
}

/* ------------------------------------------------------------------ the data */

const june: DemoArtist = {
  email: "june@example.com",
  profile: {
    slug: "june-okafor",
    name: "June Okafor",
    bio: `I paint the same patch of sky every morning, from the same chair, before anyone else is up.

Most of them go in a drawer. The ones that don't become **postcards**: a small sky in the post, once or twice a month, for a year or so. Each one has a note on the back about the weather that day, which is to say about not much at all.

I've been doing this since 2019. The chair is older.`,
    visibility: "public",
    links: [
      { kind: "instagram", label: "", url: "https://instagram.com/juneokafor.sky" },
      { kind: "website", label: "", url: "https://juneokafor.example.com" },
    ],
  },
  avatarAlt: "June Okafor",
  avatar: avatar("J", "#2f4858", "#fbf6ec"),
  bannerAlt: "A wash of morning sky over Leith",
  banner: banner("June Okafor", "Watercolour skies from a kitchen window in Leith", "#9fc5e8", "#2f4858", "#fbf6ec"),
  orientation: "landscape",
  editions: [
    {
      input: {
        slug: "twelve-skies",
        title: "Twelve Skies",
        description: `Twelve mornings, chosen from the drawer.

Twelve skies, no two alike: the first ones are from January and the last from a December that is still some way off. Every card has a few lines on the back about that day. You get the whole year for one price, and the first card goes out on the next 1st or 15th after you order.`,
        cardCount: 12,
        priceCents: 5400,
        inGallery: true,
      },
      bannerAlt: "A pale sky over the Firth of Forth",
      banner: banner("Twelve Skies", "Twelve mornings from the drawer", "#9fc5e8", "#f4c7a1", "#2f4858"),
      cards: [
        { title: "January, frost", back: { text: "Minus two and the gulls are standing on the ice like they own it." }, front: sky("January, frost", "#dfe9f3", "#f7f3ea", "#f9e3b0", "#5b6b7a", 1) },
        { title: "January, late", back: { text: "The light came back at about half three. I nearly missed it." }, front: sky("January, late", "#6c7fa1", "#e6b89c", "#f6d58e", "#3d4452", 2) },
        { title: "February, haar", back: { text: "Fog all morning. The water and the sky agreed to be the same grey." }, front: sky("February, haar", "#c9d1d6", "#e9ecee", "#eceff1", "#7d858b", 3) },
        { title: "February, clearing", back: { text: "It cleared at eleven, suddenly, as if someone had opened a window." }, front: sky("February, clearing", "#a8c8e8", "#f1f4f6", "#fff2c2", "#55657a", 4) },
        { title: "March, wind", back: { text: "Everything on the washing line went horizontal. I painted fast." }, front: sky("March, wind", "#7aa7d4", "#d9e4ee", "#f8f0d8", "#4b5a6e", 5) },
        { title: "March, equinox", back: { text: "Equal day, equal night, and a pink I had to mix three times." }, front: sky("March, equinox", "#f2b3a0", "#fbe0c8", "#ffd9a0", "#6a4f5a", 6) },
        { title: "April, showers", back: { text: "Four showers before breakfast. The fifth is in this painting." }, front: sky("April, showers", "#8ea8c3", "#c8d6e3", "#e2e9ee", "#5a6a74", 7) },
        { title: "April, first warm day", back: { text: "Sat outside for the first time. The sky was almost too blue to paint." }, front: sky("April, first warm day", "#5aa0e0", "#bfe0f7", "#fff1a8", "#4f6b5a", 8) },
        { title: "May, long evening", back: { text: "Still light at ten. The whole street out on their steps." }, front: sky("May, long evening", "#f0a06a", "#f9d9b0", "#ffe08a", "#3f4a5a", 9) },
        { title: "June, high summer", back: { text: "No clouds at all, which is the hardest sky there is." }, front: sky("June, high summer", "#4f97dd", "#a6d2f0", "#fff6c0", "#5e7a56", 10) },
        { title: "September, turning", back: { text: "The first cold morning. Steam off the tea and off the water." }, front: sky("September, turning", "#c3a9b8", "#f0d7c7", "#f5c98e", "#4a4a5a", 11) },
        { title: "December, early dark", back: { text: "Painted by lamplight at four in the afternoon. Happy new year, nearly." }, front: sky("December, early dark", "#2f3a56", "#7f6a8c", "#f3e2b4", "#1f2433", 12) },
      ],
    },
    {
      input: {
        slug: "harbour-mornings",
        title: "Harbour Mornings",
        description: `Six skies over Leith docks, from the walk I take when I can't sit still.

Smaller and rougher than the window paintings. Boats, cranes, and the water doing what it does.`,
        cardCount: 6,
        priceCents: 3000,
        inGallery: true,
      },
      bannerAlt: "Cranes against a harbour sky",
      banner: banner("Harbour Mornings", "Six walks along the docks", "#2f4858", "#8fb3c9", "#fbf6ec"),
      cards: [
        { title: "The dry dock", back: { text: "A ship the size of a street, out of the water, looking embarrassed." }, front: sky("The dry dock", "#8fb3c9", "#d7e4ec", "#f3e6c4", "#3a4a55", 21) },
        { title: "Cranes", back: { text: "Three cranes, none moving. Nobody seems to mind." }, front: sky("Cranes", "#b7c9d6", "#e6edf1", "#fff1cf", "#2e3b47", 22) },
        { title: "The swing bridge", back: { text: "Waited twenty minutes for it to swing. Worth it." }, front: sky("The swing bridge", "#6f93b4", "#cfdde8", "#f7e3a8", "#45535f", 23) },
        { title: "Low tide", back: { text: "Mud, mostly. Beautiful mud." }, front: sky("Low tide", "#c9b9a5", "#e9e0d2", "#f6ebc9", "#6b5a48", 24) },
        { title: "Rain coming", back: { text: "You can see it arrive across the water. Two minutes' warning." }, front: sky("Rain coming", "#5f6f82", "#aab7c3", "#d9dde2", "#394350", 25) },
        { title: "Last one", back: { text: "The sun came out as I finished. Typical. Thanks for a year of these." }, front: sky("Last one", "#f4b183", "#fbe3c6", "#ffe9a6", "#4a4e5e", 26) },
      ],
    },
  ],
};

const tomas: DemoArtist = {
  email: "tomas@example.com",
  profile: {
    slug: "tomas-reyes",
    name: "Tomás Reyes",
    bio: `I run a riso printer out of a shed in Oakland and draw animals that don't quite exist.

Each card is two inks on cream stock, drawn by hand and printed by a machine that is older than I am and twice as stubborn. Registration drifts. That's the point.

Postcards are the only thing I make that I don't mind leaving the house.`,
    visibility: "public",
    links: [{ kind: "custom", label: "Shop", url: "https://tomasreyes.example.com" }],
  },
  avatarAlt: "Tomás Reyes",
  avatar: avatar("T", "#e2725b", "#f6efe0"),
  bannerAlt: "Two inks on cream stock",
  banner: banner("Tomás Reyes", "Risograph animals, two colours at a time", "#e2725b", "#1f2a5a", "#f6efe0"),
  orientation: "portrait",
  editions: [
    {
      input: {
        slug: "night-creatures",
        title: "Night Creatures",
        description: `Six animals that come out after dark, in fluorescent pink and midnight blue.

An owl that isn't quite an owl. A moth with opinions. Nothing you'd want to meet in the shed at 2am, and all of them friendly.`,
        cardCount: 6,
        priceCents: 2700,
        inGallery: true,
      },
      bannerAlt: "Two-colour print of a creature at night",
      banner: banner("Night Creatures", "Six animals, two inks, after dark", "#1f2a5a", "#e2567e", "#f6efe0"),
      cards: [
        { title: "Owl, sort of", back: { text: "Not an owl. Owl-adjacent.", fontName: "Quicksand" }, front: creature("Owl, sort of", "#1f2a5a", "#ff48b0", 31) },
        { title: "The moth", back: { text: "Has opinions about your porch light.", fontName: "Quicksand" }, front: creature("The moth", "#ff48b0", "#1f2a5a", 32) },
        { title: "Raccoon, caught", back: { text: "Looked right at me. Kept eating.", fontName: "Quicksand" }, front: creature("Raccoon, caught", "#1f2a5a", "#ffb347", 33) },
        { title: "Bat", back: { text: "Upside down, which is the correct way up for a bat.", fontName: "Quicksand" }, front: creature("Bat", "#3b2d63", "#ff48b0", 34) },
        { title: "Fox, 2am", back: { text: "The shed fox. We have an arrangement.", fontName: "Quicksand" }, front: creature("Fox, 2am", "#e2567e", "#1f2a5a", 35) },
        { title: "Something in the hedge", back: { text: "Never found out. This is my best guess.", fontName: "Quicksand" }, front: creature("Something in the hedge", "#1f2a5a", "#5ad1b0", 36) },
      ],
    },
  ],
};

/* ---------------------------------------------------------------- seeding */

async function render(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** An account that can sign in: made, or found if a previous run made it, and marked verified either way. */
async function demoCustomer(email: string, name: string): Promise<string> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  let id: string;
  try {
    id = await createCustomer(email, DEMO_PASSWORD, name);
  } catch (error) {
    if (!(error instanceof EmailTakenError)) throw error;
    const [row] = await db.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.email, email)).limit(1);
    if (!row) throw error;
    id = String(row.id);
  }
  await db.update(schema.customers).set({ emailVerifiedAt: nowFor(dialect) }).where(eq(schema.customers.id, id));
  return id;
}

async function seedArtist(demo: DemoArtist): Promise<boolean> {
  if (await findArtistBySlug(demo.profile.slug)) {
    console.log(`${demo.profile.name} is already here; leaving them alone.`);
    return false;
  }

  const customerId = await demoCustomer(demo.email, demo.profile.name);
  // Profile pictures are the customer's, stored before the page exists, as the studio's own upload route does.
  const bannerImage = await storeImage(`profile-${customerId}`, await render(demo.banner(1800, 600)));
  const avatarImage = await storeImage(`profile-${customerId}`, await render(demo.avatar(800)));
  const artist = await createArtist(
    customerId,
    artistProfileInputSchema.parse({ ...demo.profile, avatar: { ...avatarImage, alt: demo.avatarAlt }, banner: { ...bannerImage, alt: demo.bannerAlt } }),
  );

  const { width, height } = PRINT_SIZES[demo.orientation];
  for (const edition of demo.editions) {
    const input = editionInputSchema.parse({ ...edition.input, banner: null });
    const created = await createEdition(artist.id, input);

    const cards: { designId: string; title: string | null }[] = [];
    for (const card of edition.cards) {
      const id = randomUUID();
      const stored = await storePostcardDesign(id, await render(card.front(width, height)), demo.orientation);
      const design = await createDesign({ artistId: artist.id, orientation: demo.orientation, back: postcardBackSchema.parse(card.back), ...stored }, id);
      cards.push({ designId: design.id, title: card.title });
    }
    if (!(await replaceEditionCards(created.id, cards))) throw new Error(`Could not set the cards of ${edition.input.title}.`);

    const bannerImage = await storeImage(`artists-${artist.id}`, await render(edition.banner(1800, 1000)));
    if (!(await updateDraftEdition(created.id, artist.id, { ...input, banner: { ...bannerImage, alt: edition.bannerAlt } }))) {
      throw new Error(`Could not give ${edition.input.title} its banner.`);
    }
    if (!(await setEditionStatus(created.id, ["draft"], "on_sale"))) throw new Error(`Could not put ${edition.input.title} on sale.`);
    console.log(`  ${edition.input.title}: ${cards.length} cards, on sale.`);
  }

  await setArtistStatus(artist.id, "live");
  console.log(`${demo.profile.name} is live at /artist/${demo.profile.slug} (sign in as ${demo.email}).`);
  return true;
}

export async function seedDemo(): Promise<void> {
  await runMigrations();
  if (await seedIfEmpty()) console.log("Platform settings seeded.");

  if ((await countAdmins()) === 0) {
    await createAdmin(process.env.ADMIN_EMAIL ?? "admin@example.com", process.env.ADMIN_PASSWORD ?? DEMO_PASSWORD);
    console.log(`Admin created: ${process.env.ADMIN_EMAIL ?? "admin@example.com"}`);
  }

  for (const demo of [june, tomas]) await seedArtist(demo);
  console.log(`\nEvery demo account's password is "${DEMO_PASSWORD}" (set DEMO_PASSWORD to choose another).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void seedDemo().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error("Demo seed failed:", error);
      process.exit(1);
    },
  );
}
