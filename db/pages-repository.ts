import { randomUUID } from "node:crypto";
import { and, asc, eq, max, ne } from "drizzle-orm";
import type { PageInput } from "../shared/api.js";
import { pageDraftSchema, pageSummarySchema, type PageDraft, type PageSummary } from "../shared/schema.js";
import { SlugTakenError } from "./admin-repository.js";
import { getDatabase } from "./client.js";

/**
 * Store pages — reads and writes together, as with shipping.
 *
 * Bodies are Markdown and leave here as Markdown. Rendering happens in the
 * route layer (`server/markdown.ts`), which keeps the parser and the sanitiser
 * out of the data layer and out of the dual-dialect test run.
 */

function toBool(value: unknown): boolean {
  return value === true || value === 1;
}

interface PageRow {
  id: string;
  slug: string;
  title: string;
  body: string;
  isLive: unknown;
  inNav: unknown;
  position: number;
}

function buildDraft(row: PageRow): PageDraft {
  return pageDraftSchema.parse({
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    isLive: toBool(row.isLive),
    inNav: toBool(row.inNav),
    position: row.position,
  });
}

interface ListOptions {
  /** Storefront callers pass true; the admin lists drafts too. */
  liveOnly?: boolean;
}

/** Nav-shaped rows for the storefront, without dragging every body along. */
export async function listPageSummaries(options: ListOptions = {}): Promise<PageSummary[]> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      title: schema.pages.title,
      inNav: schema.pages.inNav,
      position: schema.pages.position,
    })
    .from(schema.pages)
    .where(options.liveOnly ? eq(schema.pages.isLive, true) : undefined)
    .orderBy(asc(schema.pages.position), asc(schema.pages.title))) as unknown as {
    id: string;
    slug: string;
    title: string;
    inNav: unknown;
    position: number;
  }[];

  return rows.map((row) =>
    pageSummarySchema.parse({
      id: row.id,
      slug: row.slug,
      title: row.title,
      inNav: toBool(row.inNav),
      position: row.position,
    }),
  );
}

/** Every page with its Markdown source, drafts included. Admin only. */
export async function listPageDrafts(): Promise<PageDraft[]> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.pages)
    .orderBy(asc(schema.pages.position), asc(schema.pages.title))) as unknown as PageRow[];

  return rows.map(buildDraft);
}

export async function findPageBySlug(slug: string, liveOnly = true): Promise<PageDraft | null> {
  const { drizzle: db, schema } = await getDatabase();

  const filters = [eq(schema.pages.slug, slug)];
  if (liveOnly) filters.push(eq(schema.pages.isLive, true));

  const rows = (await db
    .select()
    .from(schema.pages)
    .where(and(...filters))
    .limit(1)) as unknown as PageRow[];

  const row = rows[0];
  return row ? buildDraft(row) : null;
}

export async function pageExists(id: string): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(eq(schema.pages.id, id))
    .limit(1)) as unknown as { id: string }[];

  return rows.length > 0;
}

async function assertSlugFree(slug: string, excludeId?: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  const filters = [eq(schema.pages.slug, slug)];
  if (excludeId) filters.push(ne(schema.pages.id, excludeId));

  const rows = (await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(and(...filters))
    .limit(1)) as unknown as { id: string }[];

  if (rows.length > 0) throw new SlugTakenError(slug);
}

export async function createPage(input: PageInput): Promise<string> {
  const { drizzle: db, schema } = await getDatabase();

  await assertSlugFree(input.slug);

  const positions = (await db
    .select({ value: max(schema.pages.position) })
    .from(schema.pages)) as unknown as { value: number | null }[];

  const id = randomUUID();
  await db.insert(schema.pages).values({
    id,
    slug: input.slug,
    title: input.title,
    body: input.body,
    isLive: input.isLive,
    inNav: input.inNav,
    position: (positions[0]?.value ?? -1) + 1,
  });

  return id;
}

export async function updatePage(id: string, input: PageInput): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  await assertSlugFree(input.slug, id);

  await db
    .update(schema.pages)
    .set({
      slug: input.slug,
      title: input.title,
      body: input.body,
      isLive: input.isLive,
      inNav: input.inNav,
    })
    .where(eq(schema.pages.id, id));
}

export async function deletePage(id: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  await db.delete(schema.pages).where(eq(schema.pages.id, id));
}

export async function reorderPages(ids: string[]): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  for (const [index, id] of ids.entries()) {
    await db.update(schema.pages).set({ position: index }).where(eq(schema.pages.id, id));
  }
}

/**
 * Carry an existing store's `aboutText` over into a page.
 *
 * Two systems for one thing is how the About copy ends up edited in the place
 * that is no longer read. This runs after every migration rather than inside a
 * SQL file, because it has to behave identically on both dialects, and it is
 * guarded on the page not existing rather than on a version marker — so a
 * merchant who deletes the generated page does not get it back on next boot,
 * and running migrations twice makes one page, not two.
 *
 * Returns true when a page was created, which is what the test asserts once.
 */
export async function adoptAboutTextAsPage(): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();

  const settings = (await db
    .select({ aboutText: schema.storeSettings.aboutText })
    .from(schema.storeSettings)
    .limit(1)) as unknown as { aboutText: string | null }[];

  const aboutText = settings[0]?.aboutText;
  if (!aboutText || aboutText.trim() === "") return false;

  const existing = (await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(eq(schema.pages.slug, "about"))
    .limit(1)) as unknown as { id: string }[];

  if (existing.length > 0) return false;

  const positions = (await db
    .select({ value: max(schema.pages.position) })
    .from(schema.pages)) as unknown as { value: number | null }[];

  await db.insert(schema.pages).values({
    id: randomUUID(),
    slug: "about",
    title: "About",
    // The old field was plain text split on newlines. Markdown treats a single
    // newline as a soft break, so the paragraphs are separated here rather
    // than silently collapsing into one block.
    body: aboutText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .join("\n\n"),
    isLive: true,
    inNav: true,
    position: (positions[0]?.value ?? -1) + 1,
  });

  return true;
}
