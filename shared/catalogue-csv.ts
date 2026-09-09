import { productInputSchema, type ProductInput } from "./api.js";
import type { CsvRecord, CsvValue } from "./csv.js";
import { unguardCsvField } from "./csv.js";
import { productKindSchema, slugSchema, taxCodeSchema, type Product } from "./schema.js";
import {
  findDuplicateCombination,
  optionSelectionsAreWellFormed,
} from "./product-options.js";

/**
 * The catalogue interchange format, defined once for both directions.
 *
 * One row per **variant**, product fields repeated — the shape Shopify
 * exports, which is the point: a merchant should be able to diff the two files
 * and see where their catalogue differs. Everything here is pure so the
 * importer's rules can be tested without a database or a request.
 *
 * Money is `*_cents` and an integer, per invariant 1. A column of dollars in a
 * spreadsheet is how the rounding errors get back in — a file saying `19.99`
 * invites a round trip through a float, so `19.99` is refused by name below.
 */

/**
 * Written in this order on export; read by *name* on import, so a merchant may
 * reorder or omit columns when mapping a file from another platform.
 */
export const CATALOGUE_CSV_COLUMNS = [
  "slug",
  "name",
  "kind",
  "description",
  "bullet_points",
  "seo_title",
  "seo_description",
  "tax_code",
  "option1_name",
  "option1_value",
  "option2_name",
  "option2_value",
  "option3_name",
  "option3_value",
  "variant_sku",
  "variant_price_cents",
  "variant_compare_at_price_cents",
  "variant_inventory_type",
  "variant_inventory_quantity",
  "variant_weight_grams",
  "is_live",
  "image_paths",
  "variant_image_paths",
] as const;

export type CatalogueCsvColumn = (typeof CATALOGUE_CSV_COLUMNS)[number];

/** Without these three there is nothing to identify, name or price. */
export const REQUIRED_IMPORT_COLUMNS: readonly CatalogueCsvColumn[] = [
  "slug",
  "name",
  "variant_price_cents",
];

/** Lists inside one cell, as `a|b|c`. Chosen because a comma is the delimiter. */
const LIST_SEPARATOR = "|";

const MAX_AXES = 3;

/* ------------------------------------------------------------------ export */

/** One row per variant, with the product's own fields repeated on each. */
export function productCsvRows(product: Product): CsvValue[][] {
  const imagePaths = product.images.map((image) => image.path).join(LIST_SEPARATOR);

  return product.variants.map((variant) => {
    const axis = (index: number) => [
      product.options[index]?.name ?? "",
      variant.optionValues[index] ?? "",
    ];

    return [
      product.slug,
      product.name,
      product.kind,
      product.description,
      product.bulletPoints.join(LIST_SEPARATOR),
      product.seoTitle ?? "",
      product.seoDescription ?? "",
      product.taxCode ?? "",
      ...axis(0),
      ...axis(1),
      ...axis(2),
      variant.sku ?? "",
      variant.priceCents,
      // Blank rather than 0: 0 would read as a real markdown to zero, not "no
      // compare-at price at all" — the same reason inventory does this below.
      variant.compareAtPriceCents ?? "",
      variant.inventory.type,
      // Blank rather than 0 for an unlimited variant: 0 reads as "out of
      // stock", which is the opposite of what it means here.
      variant.inventory.type === "finite" ? variant.inventory.quantity : "",
      variant.weightGrams,
      product.isLive,
      imagePaths,
      product.images
        .filter((image) => image.variantId === variant.id)
        .map((image) => image.path)
        .join(LIST_SEPARATOR),
    ];
  });
}

/* ------------------------------------------------------------------ import */

/** One problem, located precisely enough for a merchant to go and fix it. */
export interface ImportIssue {
  /** 1-based line in the file, header included, as a spreadsheet counts. */
  row: number;
  column: string;
  message: string;
}

/** What the import will do to one product, for the preview table. */
export interface ImportPlanEntry {
  slug: string;
  name: string;
  action: "create" | "update";
  variants: number;
  /** The file lines this product was built from. */
  rows: number[];
  /** Present only when the group validated; absent means it will be skipped. */
  input?: ProductInput;
  /** The product being updated. Absent for a create. */
  productId?: string;
}

export interface ImportPlan {
  /** Data rows read, header excluded. */
  rows: number;
  creates: number;
  updates: number;
  entries: ImportPlanEntry[];
  errors: ImportIssue[];
}

/** A problem with the file as a whole rather than with one of its rows. */
export class CsvFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvFormatError";
  }
}

/**
 * Map column name to position.
 *
 * Names are matched case-insensitively and trimmed, because a spreadsheet
 * round trip adds whitespace and capitalisation of its own. Unknown columns
 * are ignored rather than refused, so a Shopify export with fifty extra
 * columns can be fed in after renaming only the ones that matter.
 */
export function readCsvHeader(fields: string[]): Map<string, number> {
  const header = new Map<string, number>();

  fields.forEach((field, index) => {
    // The BOM this codebase writes for Excel's benefit rides on the first cell.
    const name = field.replace(/^\uFEFF/, "").trim().toLowerCase();
    if (name === "") return;

    if (header.has(name)) {
      throw new CsvFormatError(
        `The column "${name}" appears twice. Every column name must be unique.`,
      );
    }
    header.set(name, index);
  });

  const missing = REQUIRED_IMPORT_COLUMNS.filter((column) => !header.has(column));
  if (missing.length > 0) {
    throw new CsvFormatError(
      `The file is missing the ${missing.join(", ")} column${missing.length > 1 ? "s" : ""}. The first row must be a header naming each column.`,
    );
  }

  return header;
}

/**
 * A group's rows, and the errors found while reading them.
 *
 * Collected rather than thrown: a merchant fixing a 500-row file one error per
 * attempt will give up, so every check below records and carries on.
 */
class IssueLog {
  readonly issues: ImportIssue[] = [];

  add(row: number, column: string, message: string): void {
    this.issues.push({ row, column, message });
  }

  get empty(): boolean {
    return this.issues.length === 0;
  }
}

function cell(record: CsvRecord, header: Map<string, number>, column: string): string | undefined {
  const index = header.get(column);
  if (index === undefined) return undefined;
  return unguardCsvField(record.fields[index] ?? "").trim();
}

function parseBoolean(value: string): boolean | null {
  const normalised = value.trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(normalised)) return true;
  if (["false", "no", "n", "0"].includes(normalised)) return false;
  return null;
}

/**
 * A non-negative integer, refusing the decimal spelling by name.
 *
 * "19.99" in a `_cents` column is the single most likely mistake in this file,
 * and the generic "must be a whole number" would leave a merchant guessing
 * whether the fix is `20` or `1999`.
 */
function parseCents(value: string): number | string {
  if (/^\d+(\.\d+)?$/.test(value) && value.includes(".")) {
    const asCents = Math.round(Number(value) * 100);
    return `This column is in cents, so a price of ${value} is written ${asCents}, not ${value}.`;
  }
  if (!/^\d+$/.test(value)) return "Must be a whole number of cents, like 1999.";
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return "That number is too large.";
  return parsed;
}

function splitList(value: string): string[] {
  return value
    .split(LIST_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/**
 * Group rows by slug, preserving the order the file lists them in.
 *
 * A product's rows do not have to be adjacent — a merchant sorting the
 * spreadsheet by price would scatter them — so grouping is by key, not by run.
 */
function groupBySlug(
  records: CsvRecord[],
  header: Map<string, number>,
  log: IssueLog,
): Map<string, CsvRecord[]> {
  const groups = new Map<string, CsvRecord[]>();

  for (const record of records) {
    const slug = cell(record, header, "slug") ?? "";

    if (slug === "") {
      log.add(record.line, "slug", "Every row needs a slug saying which product it belongs to.");
      continue;
    }

    const parsed = slugSchema.safeParse(slug);
    if (!parsed.success) {
      log.add(
        record.line,
        "slug",
        `"${slug}" is not a valid slug — use lowercase letters, numbers and hyphens.`,
      );
      continue;
    }

    const existing = groups.get(slug);
    if (existing) existing.push(record);
    else groups.set(slug, [record]);
  }

  return groups;
}

/**
 * Read a column that describes the product rather than the variant.
 *
 * These repeat on every row of a group. A blank on a continuation row means
 * "same as above" — which is how Shopify writes them — but a *different*
 * non-blank value is a mistake worth naming, rather than silently resolving in
 * favour of whichever row happened to come first.
 *
 * Returns undefined when the column is absent from the file entirely. The
 * caller then leaves the stored value alone instead of overwriting it with a
 * default, so a three-column price list cannot wipe a catalogue's SEO text.
 */
function productCell(
  rows: CsvRecord[],
  header: Map<string, number>,
  column: CatalogueCsvColumn,
  log: IssueLog,
): string | undefined {
  if (!header.has(column)) return undefined;

  const first = cell(rows[0]!, header, column) ?? "";

  for (const row of rows.slice(1)) {
    const value = cell(row, header, column) ?? "";
    // Blank is "same as above"; a different value is a genuine disagreement.
    if (value !== "" && value !== first) {
      log.add(
        row.line,
        column,
        `${column} differs from the first row for "${cell(rows[0]!, header, "slug")}" ("${value}" against "${first}"). Every row for one product must agree.`,
      );
    }
  }

  return first;
}

/** The axes this group declares, checked for the shapes that cannot work. */
function readAxes(
  rows: CsvRecord[],
  header: Map<string, number>,
  log: IssueLog,
): { name: string; values: string[] }[] {
  const names: string[] = [];

  for (let index = 0; index < MAX_AXES; index += 1) {
    const column = `option${index + 1}_name` as CatalogueCsvColumn;
    const name = productCell(rows, header, column, log) ?? "";

    if (name === "") {
      // A gap would make "the value in option2_value" ambiguous about which
      // axis it belongs to, so axes must be contiguous from the first.
      const laterNamed = [index + 1, index + 2]
        .filter((next) => next < MAX_AXES)
        .find((next) => (productCell(rows, header, `option${next + 1}_name` as CatalogueCsvColumn, new IssueLog()) ?? "") !== "");

      if (laterNamed !== undefined) {
        log.add(
          rows[0]!.line,
          column,
          `option${laterNamed + 1}_name is set but ${column} is empty. Options must be filled in from the first.`,
        );
      }
      break;
    }

    names.push(name);
  }

  return names.map((name, index) => {
    const column = `option${index + 1}_value` as CatalogueCsvColumn;
    const values: string[] = [];

    for (const row of rows) {
      const value = cell(row, header, column) ?? "";
      if (value === "") {
        log.add(row.line, column, `“${name}” is one of this product's options, so every row must give a value for it.`);
        continue;
      }
      // First-seen order, which is the order the selector will render in.
      if (!values.includes(value)) values.push(value);
    }

    return { name, values };
  });
}

/** The values this row names on each axis, in axis order. */
function readOptionValues(
  row: CsvRecord,
  header: Map<string, number>,
  axisCount: number,
): string[] {
  return Array.from({ length: axisCount }, (_unused, index) =>
    cell(row, header, `option${index + 1}_value` as CatalogueCsvColumn) ?? "",
  );
}

function readVariant(
  row: CsvRecord,
  header: Map<string, number>,
  optionValues: string[],
  log: IssueLog,
): ProductInput["variants"][number] {
  const priceRaw = cell(row, header, "variant_price_cents") ?? "";
  let priceCents = 0;

  if (priceRaw === "") {
    log.add(row.line, "variant_price_cents", "A price is required.");
  } else {
    const parsed = parseCents(priceRaw);
    if (typeof parsed === "string") log.add(row.line, "variant_price_cents", parsed);
    else priceCents = parsed;
  }

  const skuRaw = cell(row, header, "variant_sku") ?? "";
  const sku = skuRaw === "" ? null : skuRaw;
  if (sku !== null && /\s/.test(sku)) {
    log.add(row.line, "variant_sku", "A SKU must not contain whitespace.");
  }

  const compareAtRaw = cell(row, header, "variant_compare_at_price_cents") ?? "";
  let compareAtPriceCents: number | null = null;
  if (compareAtRaw !== "") {
    const parsed = parseCents(compareAtRaw);
    if (typeof parsed === "string") log.add(row.line, "variant_compare_at_price_cents", parsed);
    else compareAtPriceCents = parsed;
  }

  const typeRaw = (cell(row, header, "variant_inventory_type") ?? "").toLowerCase();
  const quantityRaw = cell(row, header, "variant_inventory_quantity") ?? "";

  let inventoryType: "finite" | "infinite" = "infinite";
  if (typeRaw === "finite" || typeRaw === "infinite") {
    inventoryType = typeRaw;
  } else if (typeRaw !== "") {
    log.add(
      row.line,
      "variant_inventory_type",
      `“${typeRaw}” is not an inventory type. Use "finite" to track stock or "infinite" for unlimited.`,
    );
  }

  let quantity = 0;
  if (quantityRaw !== "") {
    if (!/^\d+$/.test(quantityRaw)) {
      log.add(row.line, "variant_inventory_quantity", "Must be a whole number of units, like 12.");
    } else {
      quantity = Number(quantityRaw);
      if (inventoryType === "infinite" && typeRaw !== "") {
        log.add(
          row.line,
          "variant_inventory_quantity",
          "An unlimited variant has no stock count. Leave this blank, or set variant_inventory_type to finite.",
        );
      }
    }
  } else if (inventoryType === "finite") {
    log.add(
      row.line,
      "variant_inventory_quantity",
      "A finite variant needs a stock count. Enter 0 if it is out of stock.",
    );
  }

  let weightGrams = 0;
  const weightRaw = cell(row, header, "variant_weight_grams") ?? "";
  if (weightRaw !== "") {
    if (!/^\d+$/.test(weightRaw)) {
      log.add(row.line, "variant_weight_grams", "Must be a whole number of grams, like 250.");
    } else {
      weightGrams = Number(weightRaw);
    }
  }

  return {
    label: "",
    priceCents,
    sku,
    compareAtPriceCents,
    inventory:
      inventoryType === "finite"
        ? { type: "finite" as const, quantity }
        : { type: "infinite" as const },
    weightGrams,
    optionValues,
  };
}

/**
 * Which existing variant each imported row is, so an update keeps its id.
 *
 * Load-bearing rather than an optimisation: `updateProduct` deletes any variant
 * whose id is absent from the input, and a deleted variant takes its
 * `stripePriceId` with it. Rebuilding every variant on every import would
 * detach a live catalogue from the Prices its past orders resolve through —
 * which would make "export, import, nothing changed" quietly false.
 *
 * Matched on the combination of option values, the only stable identity a CSV
 * row carries. A product with no options has exactly one variant, so the match
 * is unambiguous there too.
 */
function adoptVariantIds(
  variants: ProductInput["variants"],
  existing: Product | undefined,
): ProductInput["variants"] {
  if (!existing) return variants;

  const bySku = new Map(
    existing.variants
      .filter((variant): variant is typeof variant & { sku: string } => variant.sku !== null)
      .map((variant) => [variant.sku, variant.id]),
  );
  const byCombination = new Map(
    existing.variants.map((variant) => [variant.optionValues.join(" "), variant.id]),
  );

  return variants.map((variant) => {
    // A SKU is a deliberate merchant identifier; an option combination is
    // only inferred. When a row's SKU matches an existing variant, that
    // match wins even if the combination also happens to match another.
    const id =
      (variant.sku !== null ? bySku.get(variant.sku) : undefined) ??
      (existing.options.length === 0 && variants.length === 1
        ? existing.variants[0]?.id
        : byCombination.get(variant.optionValues.join(" ")));

    return id ? { ...variant, id } : variant;
  });
}

/**
 * Translate a zod complaint about the assembled product back to a file cell.
 *
 * Reusing `productInputSchema` is what stops the importer creating something
 * the product editor would refuse, but its issue paths speak in terms of the
 * assembled object — `variants.2.priceCents` — and a merchant needs a row and
 * a column.
 */
function locateIssue(
  path: readonly PropertyKey[],
  rows: CsvRecord[],
): { row: number; column: string } {
  const [head, index, field] = path;
  const firstLine = rows[0]?.line ?? 1;

  if (head === "variants" && typeof index === "number") {
    const line = rows[index]?.line ?? firstLine;
    const column =
      field === "priceCents"
        ? "variant_price_cents"
        : field === "sku"
          ? "variant_sku"
          : field === "compareAtPriceCents"
            ? "variant_compare_at_price_cents"
            : field === "inventory"
              ? "variant_inventory_quantity"
              : field === "weightGrams"
                ? "variant_weight_grams"
                : "variant_price_cents";
    return { row: line, column };
  }

  const byField: Partial<Record<string, CatalogueCsvColumn>> = {
    slug: "slug",
    name: "name",
    kind: "kind",
    description: "description",
    bulletPoints: "bullet_points",
    seoTitle: "seo_title",
    seoDescription: "seo_description",
    taxCode: "tax_code",
    options: "option1_name",
    isLive: "is_live",
  };

  return { row: firstLine, column: byField[String(head)] ?? "slug" };
}

/**
 * Turn a parsed file into the exact set of writes it implies, and every reason
 * it cannot be applied.
 *
 * Pure: it is handed the products that already exist rather than reading them,
 * so the whole rule set is testable without a database, and so the route can
 * run it twice — once to preview, once to commit — over the same inputs.
 */
export function buildImportPlan(options: {
  records: CsvRecord[];
  header: Map<string, number>;
  existing: Map<string, Product>;
}): ImportPlan {
  const { records, header, existing } = options;
  const log = new IssueLog();
  const groups = groupBySlug(records, header, log);
  const entries: ImportPlanEntry[] = [];

  for (const [slug, rows] of groups) {
    const groupLog = new IssueLog();
    const current = existing.get(slug);
    const axes = readAxes(rows, header, groupLog);

    if (axes.length === 0) {
      /*
       * Refusing to collapse a matrix by omission.
       *
       * The rows define the variants, so one row and no option columns would
       * mean "this product now has a single unnamed price" — deleting the rest
       * along with their stock and their Stripe Prices. That is a plausible
       * thing to do by accident (a merchant exports a price list from
       * elsewhere with only slug, name and price) and an implausible thing to
       * mean, so it is named rather than performed. Clearing the axes
       * deliberately is what the product editor is for.
       */
      if (current && current.options.length > 0) {
        groupLog.add(
          rows[0]!.line,
          "option1_name",
          `“${current.name}” has ${current.options.length === 1 ? "the option" : "options"} ${current.options
            .map((option) => `“${option.name}”`)
            .join(" and ")}, but this file gives none. Include the option columns, or the import would delete its ${current.variants.length} prices.`,
        );
      }

      // No axes means no matrix, so the group is one product with one price.
      for (let index = 0; index < MAX_AXES; index += 1) {
        const column = `option${index + 1}_value` as CatalogueCsvColumn;
        for (const row of rows) {
          if ((cell(row, header, column) ?? "") !== "") {
            groupLog.add(
              row.line,
              column,
              `${column} is set but option${index + 1}_name is empty. Name the option, or clear the value.`,
            );
          }
        }
      }

      if (rows.length > 1) {
        groupLog.add(
          rows[1]!.line,
          "slug",
          `"${slug}" has ${rows.length} rows but no options. A product with no options can only have one price.`,
        );
      }
    }

    const variants = rows.map((row) =>
      readVariant(row, header, readOptionValues(row, header, axes.length), groupLog),
    );

    /*
     * A column the file does not carry leaves the stored value alone.
     *
     * The alternative — filling in the schema default — means importing a
     * three-column price list would blank every description and SEO tag in the
     * catalogue. Present-but-empty still means "set this to empty", so the
     * merchant keeps a way to clear a field.
     */
    const keep = <T>(value: string | undefined, read: (raw: string) => T, fallback: T): T =>
      value === undefined ? fallback : read(value);

    const kindRaw = productCell(rows, header, "kind", groupLog);
    const isLiveRaw = productCell(rows, header, "is_live", groupLog);
    const taxCodeRaw = productCell(rows, header, "tax_code", groupLog);

    if (kindRaw !== undefined && kindRaw !== "" && !productKindSchema.safeParse(kindRaw).success) {
      groupLog.add(rows[0]!.line, "kind", `“${kindRaw}” is not a product kind. Use "physical" or "digital".`);
    }

    if (isLiveRaw !== undefined && isLiveRaw !== "" && parseBoolean(isLiveRaw) === null) {
      groupLog.add(rows[0]!.line, "is_live", `“${isLiveRaw}” is not a yes or no. Use true or false.`);
    }

    if (taxCodeRaw !== undefined && taxCodeRaw !== "" && !taxCodeSchema.safeParse(taxCodeRaw).success) {
      groupLog.add(
        rows[0]!.line,
        "tax_code",
        `“${taxCodeRaw}” is not a Stripe tax code. They look like txcd_99999999. Leave it blank to use the store default.`,
      );
    }

    const candidate = {
      slug,
      name: keep(productCell(rows, header, "name", groupLog), (raw) => raw, current?.name ?? ""),
      kind: keep(kindRaw, (raw) => (raw === "" ? "physical" : raw), current?.kind ?? "physical"),
      description: keep(
        productCell(rows, header, "description", groupLog),
        (raw) => raw,
        current?.description ?? "",
      ),
      bulletPoints: keep(
        productCell(rows, header, "bullet_points", groupLog),
        splitList,
        current?.bulletPoints ?? [],
      ),
      seoTitle: keep(
        productCell(rows, header, "seo_title", groupLog),
        (raw) => (raw === "" ? null : raw),
        current?.seoTitle ?? null,
      ),
      seoDescription: keep(
        productCell(rows, header, "seo_description", groupLog),
        (raw) => (raw === "" ? null : raw),
        current?.seoDescription ?? null,
      ),
      taxCode: keep(taxCodeRaw, (raw) => (raw === "" ? null : raw), current?.taxCode ?? null),
      /*
       * Never from the file. Non-priced choices like gift wrap are a nested
       * list that a flat row cannot express, so the CSV does not manage them
       * and an import leaves whatever the product editor set.
       */
      optionGroups: current?.optionGroups ?? [],
      variants,
      options: axes,
      isLive: keep(isLiveRaw, (raw) => parseBoolean(raw) ?? false, current?.isLive ?? false),
    };

    // Only worth asking the schema once the cells themselves make sense;
    // otherwise it reports the same problem a second time in its own words.
    if (groupLog.empty) {
      const parsed = productInputSchema.safeParse(candidate);

      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const { row, column } = locateIssue(issue.path, rows);
          groupLog.add(row, column, issue.message);
        }
      } else {
        if (!optionSelectionsAreWellFormed(parsed.data.options, parsed.data.variants)) {
          groupLog.add(
            rows[0]!.line,
            "option1_value",
            "Every row must choose exactly one value for each option, from that option's own list.",
          );
        }

        const duplicate = findDuplicateCombination(parsed.data.variants);
        if (duplicate) {
          const duplicateRow =
            rows[
              parsed.data.variants.findLastIndex(
                (variant) => variant.optionValues.join(" ") === duplicate.join(" "),
              )
            ];

          groupLog.add(
            duplicateRow?.line ?? rows[0]!.line,
            "option1_value",
            duplicate.length > 0
              ? `Two rows are both “${duplicate.join(" / ")}.” Combinations must be unique.`
              : "A product with no options can only have one price.",
          );
        }

        // Cross-product duplicates can only be caught once the product is
        // actually written — this file's own rows are the one place a
        // duplicate SKU can be caught for free, before anything is saved.
        const seenSkus = new Set<string>();
        for (const [rowIndex, variant] of parsed.data.variants.entries()) {
          if (variant.sku === null) continue;

          if (seenSkus.has(variant.sku)) {
            groupLog.add(
              rows[rowIndex]?.line ?? rows[0]!.line,
              "variant_sku",
              `Two rows in this file are both “${variant.sku}.” SKUs must be unique.`,
            );
          }

          seenSkus.add(variant.sku);
        }

        if (groupLog.empty) {
          entries.push({
            slug,
            name: parsed.data.name,
            action: current ? "update" : "create",
            variants: parsed.data.variants.length,
            rows: rows.map((row) => row.line),
            input: { ...parsed.data, variants: adoptVariantIds(parsed.data.variants, current) },
            ...(current ? { productId: current.id } : {}),
          });
        }
      }
    }

    if (!groupLog.empty) {
      log.issues.push(...groupLog.issues);
      entries.push({
        slug,
        name: candidate.name,
        action: current ? "update" : "create",
        variants: rows.length,
        rows: rows.map((row) => row.line),
        ...(current ? { productId: current.id } : {}),
      });
    }
  }

  // By file position, so the list reads top to bottom like the spreadsheet.
  log.issues.sort((a, b) => a.row - b.row || a.column.localeCompare(b.column));

  const valid = entries.filter((entry) => entry.input);

  return {
    rows: records.length,
    creates: valid.filter((entry) => entry.action === "create").length,
    updates: valid.filter((entry) => entry.action === "update").length,
    entries,
    errors: log.issues,
  };
}
