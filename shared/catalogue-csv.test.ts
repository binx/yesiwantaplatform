import { describe, expect, it } from "vitest";
import { CsvStreamParser, csvRow, unguardCsvField } from "./csv.js";
import {
  CATALOGUE_CSV_COLUMNS,
  CsvFormatError,
  buildImportPlan,
  productCsvRows,
  readCsvHeader,
  type ImportPlan,
} from "./catalogue-csv.js";
import type { Product } from "./schema.js";

/**
 * The interchange format.
 *
 * The round trip is the assertion that matters — a merchant who exports,
 * changes one price and imports must not discover the import rewrote
 * everything else — so most of what follows builds a product, renders it, and
 * reads it back.
 */

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    slug: "canvas-tote",
    name: "Canvas Tote",
    kind: "physical",
    description: "A bag.",
    bulletPoints: ["Roomy", "Washable"],
    seoTitle: null,
    seoDescription: null,
    images: [],
    variantName: null,
    variants: [
      {
        id: "v1",
        label: "",
        priceCents: 3400,
        inventory: { type: "infinite" },
        weightGrams: 0,
        stripePriceId: null,
        optionValues: [],
      },
    ],
    options: [],
    optionGroups: [],
    taxCode: null,
    isLive: false,
    stripeProductId: null,
    stripeTaxSignature: null,
    ...overrides,
  };
}

/** Two axes, four variants — the shape the importer has to rebuild. */
function twoAxisProduct(): Product {
  return product({
    id: "p2",
    slug: "shirt",
    name: "Shirt",
    options: [
      { id: "o1", name: "Size", values: ["Small", "Large"] },
      { id: "o2", name: "Colour", values: ["Blue", "Red"] },
    ],
    variants: [
      ["Small", "Blue"],
      ["Small", "Red"],
      ["Large", "Blue"],
      ["Large", "Red"],
    ].map((optionValues, index) => ({
      id: `v${index + 1}`,
      label: optionValues.join(" / "),
      priceCents: 2000 + index,
      inventory: { type: "finite" as const, quantity: index },
      weightGrams: 100,
      stripePriceId: null,
      optionValues,
    })),
  });
}

/** Render products the way the export route does, then read them back. */
function roundTrip(products: Product[], existing = products): ImportPlan {
  const text =
    csvRow(CATALOGUE_CSV_COLUMNS) +
    products.flatMap((each) => productCsvRows(each)).map(csvRow).join("");

  return planFor(text, existing);
}

function planFor(text: string, existing: Product[] = []): ImportPlan {
  const parser = new CsvStreamParser();
  const records = [...parser.push(text), ...parser.end()];
  const [headerRecord, ...rest] = records;

  return buildImportPlan({
    records: rest,
    header: readCsvHeader(headerRecord?.fields ?? []),
    existing: new Map(existing.map((each) => [each.slug, each])),
  });
}

describe("CsvStreamParser", () => {
  it("reads plain rows", () => {
    const parser = new CsvStreamParser();
    expect([...parser.push("a,b\n1,2\n"), ...parser.end()]).toEqual([
      { line: 1, fields: ["a", "b"] },
      { line: 2, fields: ["1", "2"] },
    ]);
  });

  it("reads a final row with no trailing newline", () => {
    const parser = new CsvStreamParser();
    expect([...parser.push("a,b\n1,2"), ...parser.end()]).toEqual([
      { line: 1, fields: ["a", "b"] },
      { line: 2, fields: ["1", "2"] },
    ]);
  });

  it("unquotes fields and reads embedded commas, quotes and newlines", () => {
    const parser = new CsvStreamParser();
    const rows = [...parser.push('"Marfa, TX","The ""big"" one","two\nlines"\n'), ...parser.end()];

    expect(rows[0]?.fields).toEqual(["Marfa, TX", 'The "big" one', "two\nlines"]);
  });

  it("survives a chunk boundary anywhere", () => {
    const source = 'slug,name\r\ntote,"The ""big"", one"\r\nmug,Mug\r\n';

    // Every possible split point, because the real boundary is the socket's.
    for (let cut = 0; cut <= source.length; cut += 1) {
      const parser = new CsvStreamParser();
      const rows = [
        ...parser.push(source.slice(0, cut)),
        ...parser.push(source.slice(cut)),
        ...parser.end(),
      ];

      expect(rows.map((row) => row.fields)).toEqual([
        ["slug", "name"],
        ["tote", 'The "big", one'],
        ["mug", "Mug"],
      ]);
    }
  });

  it("skips blank lines rather than reading them as empty records", () => {
    const parser = new CsvStreamParser();
    const rows = [...parser.push("a,b\n\n1,2\n\n"), ...parser.end()];

    expect(rows.map((row) => row.fields)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("counts lines so an error can name one", () => {
    const parser = new CsvStreamParser();
    const rows = [...parser.push('a\nb\n"two\nlines"\nlast\n'), ...parser.end()];

    // The record starting on line 3 spans two lines, so "last" is line 5.
    expect(rows.map((row) => row.line)).toEqual([1, 2, 3, 5]);
  });
});

describe("unguardCsvField", () => {
  it("removes the apostrophe the formula guard added", () => {
    expect(unguardCsvField("'=1+1")).toBe("=1+1");
    expect(unguardCsvField("'-5")).toBe("-5");
  });

  it("leaves an apostrophe a merchant actually typed", () => {
    expect(unguardCsvField("'tis the season")).toBe("'tis the season");
    expect(unguardCsvField("O'Brien")).toBe("O'Brien");
  });
});

describe("readCsvHeader", () => {
  it("matches names case-insensitively and ignores unknown columns", () => {
    const header = readCsvHeader(["Slug", " NAME ", "variant_price_cents", "shopify_id"]);

    expect(header.get("slug")).toBe(0);
    expect(header.get("name")).toBe(1);
    expect(header.get("shopify_id")).toBe(3);
  });

  it("strips the byte-order mark from the first column", () => {
    const header = readCsvHeader(["﻿slug", "name", "variant_price_cents"]);
    expect(header.get("slug")).toBe(0);
  });

  it("refuses a file missing a column it cannot do without", () => {
    expect(() => readCsvHeader(["slug", "name"])).toThrow(CsvFormatError);
    expect(() => readCsvHeader(["slug", "name"])).toThrow(/variant_price_cents/);
  });

  it("refuses a duplicated column rather than picking one", () => {
    expect(() => readCsvHeader(["slug", "name", "variant_price_cents", "name"])).toThrow(
      /appears twice/,
    );
  });
});

describe("export", () => {
  it("writes one row per variant with the product's fields repeated", () => {
    const rows = productCsvRows(twoAxisProduct());

    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row[0] === "shirt" && row[1] === "Shirt")).toBe(true);
  });

  it("writes prices as integer cents", () => {
    const [row] = productCsvRows(product());
    expect(row?.[CATALOGUE_CSV_COLUMNS.indexOf("variant_price_cents")]).toBe(3400);
  });

  it("leaves the stock count blank for an unlimited variant", () => {
    const [row] = productCsvRows(product());
    expect(row?.[CATALOGUE_CSV_COLUMNS.indexOf("variant_inventory_quantity")]).toBe("");
  });
});

describe("the round trip", () => {
  it("is a no-op: nothing created, nothing changed", () => {
    const products = [product(), twoAxisProduct()];
    const plan = roundTrip(products);

    expect(plan.errors).toEqual([]);
    expect(plan.creates).toBe(0);
    expect(plan.updates).toBe(2);

    // An update that reproduces what is stored is still an update; what must
    // hold is that every field survived unchanged.
    const tote = plan.entries.find((entry) => entry.slug === "canvas-tote")?.input;
    expect(tote).toMatchObject({
      name: "Canvas Tote",
      description: "A bag.",
      bulletPoints: ["Roomy", "Washable"],
      kind: "physical",
      isLive: false,
      taxCode: null,
    });
  });

  it("survives multi-axis options", () => {
    const plan = roundTrip([twoAxisProduct()]);
    const input = plan.entries[0]?.input;

    expect(input?.options).toEqual([
      { name: "Size", values: ["Small", "Large"] },
      { name: "Colour", values: ["Blue", "Red"] },
    ]);
    expect(input?.variants.map((variant) => variant.optionValues)).toEqual([
      ["Small", "Blue"],
      ["Small", "Red"],
      ["Large", "Blue"],
      ["Large", "Red"],
    ]);
  });

  it("keeps each variant's id, so its Stripe Price is not orphaned", () => {
    const plan = roundTrip([twoAxisProduct()]);

    expect(plan.entries[0]?.input?.variants.map((variant) => variant.id)).toEqual([
      "v1",
      "v2",
      "v3",
      "v4",
    ]);
  });

  it("survives values a spreadsheet would otherwise evaluate", () => {
    const hostile = product({
      name: "=HYPERLINK(\"http://evil\")",
      description: '-20% off, "today" only',
      bulletPoints: ["+1 free"],
    });

    const input = roundTrip([hostile]).entries[0]?.input;

    expect(input?.name).toBe("=HYPERLINK(\"http://evil\")");
    expect(input?.description).toBe('-20% off, "today" only');
    expect(input?.bulletPoints).toEqual(["+1 free"]);
  });

  it("survives fields the brief's column list did not carry", () => {
    // kind, SEO text and the tax code all round-trip, because an update writes
    // the whole product: without columns for them an import would blank them.
    const detailed = product({
      kind: "digital",
      seoTitle: "Buy a tote",
      seoDescription: "The roomy one.",
      taxCode: "txcd_10000000",
      isLive: true,
    });

    expect(roundTrip([detailed]).entries[0]?.input).toMatchObject({
      kind: "digital",
      seoTitle: "Buy a tote",
      seoDescription: "The roomy one.",
      taxCode: "txcd_10000000",
      isLive: true,
    });
  });

  it("keeps non-priced option groups, which the file does not carry", () => {
    const wrapped = product({ optionGroups: [{ name: "Gift wrap", choices: ["Yes", "No"] }] });

    expect(roundTrip([wrapped]).entries[0]?.input?.optionGroups).toEqual([
      { name: "Gift wrap", choices: ["Yes", "No"] },
    ]);
  });
});

describe("creating and updating", () => {
  it("creates when the slug is absent and updates when it is present", () => {
    const plan = roundTrip([product(), twoAxisProduct()], [product()]);

    expect(plan.creates).toBe(1);
    expect(plan.updates).toBe(1);
    expect(plan.entries.find((entry) => entry.slug === "shirt")?.action).toBe("create");
  });

  it("leaves stored values alone for columns the file does not carry", () => {
    const stored = product({
      description: "A bag.",
      seoTitle: "Buy a tote",
      bulletPoints: ["Roomy"],
    });

    // A price list: the only columns are the three that are required.
    const plan = planFor("slug,name,variant_price_cents\ncanvas-tote,Canvas Tote,4000\n", [stored]);

    expect(plan.errors).toEqual([]);
    expect(plan.entries[0]?.input).toMatchObject({
      description: "A bag.",
      seoTitle: "Buy a tote",
      bulletPoints: ["Roomy"],
    });
    expect(plan.entries[0]?.input?.variants[0]?.priceCents).toBe(4000);
  });

  it("still lets a present-but-empty column clear a field", () => {
    const stored = product({ seoTitle: "Buy a tote" });
    const plan = planFor(
      "slug,name,variant_price_cents,seo_title\ncanvas-tote,Canvas Tote,4000,\n",
      [stored],
    );

    expect(plan.entries[0]?.input?.seoTitle).toBeNull();
  });

  it("groups a product's rows even when the file interleaves them", () => {
    const plan = planFor(
      [
        "slug,name,variant_price_cents,option1_name,option1_value",
        "shirt,Shirt,2000,Size,Small",
        "mug,Mug,900,,",
        "shirt,Shirt,2100,Size,Large",
      ].join("\n"),
    );

    expect(plan.errors).toEqual([]);
    expect(plan.entries.find((entry) => entry.slug === "shirt")?.variants).toBe(2);
  });
});

describe("errors", () => {
  it("reports every bad row at once, with its row and column", () => {
    const plan = planFor(
      [
        "slug,name,variant_price_cents",
        "good-one,Fine,1000",
        "bad-price,Bad price,19.99",
        ",No slug,1000",
        "bad-weight,Bad,not-a-number",
      ].join("\n"),
    );

    expect(plan.errors).toHaveLength(3);
    expect(plan.errors.map((error) => [error.row, error.column])).toEqual([
      [3, "variant_price_cents"],
      [4, "slug"],
      [5, "variant_price_cents"],
    ]);
  });

  it("says how a decimal price should have been written", () => {
    const plan = planFor("slug,name,variant_price_cents\ntote,Tote,19.99\n");
    expect(plan.errors[0]?.message).toContain("1999");
  });

  it("keeps the valid products alongside the invalid ones", () => {
    const plan = planFor(
      ["slug,name,variant_price_cents", "good-one,Fine,1000", "bad-one,Bad,19.99"].join("\n"),
    );

    expect(plan.creates).toBe(1);
    expect(plan.entries.find((entry) => entry.slug === "good-one")?.input).toBeDefined();
    expect(plan.entries.find((entry) => entry.slug === "bad-one")?.input).toBeUndefined();
  });

  it("rejects two rows naming the same combination", () => {
    const plan = planFor(
      [
        "slug,name,variant_price_cents,option1_name,option1_value",
        "shirt,Shirt,2000,Size,Small",
        "shirt,Shirt,2100,Size,Small",
      ].join("\n"),
    );

    expect(plan.errors[0]?.message).toContain("Small");
    expect(plan.errors[0]?.row).toBe(3);
  });

  it("rejects a second row for a product with no options", () => {
    const plan = planFor(
      ["slug,name,variant_price_cents", "tote,Tote,2000", "tote,Tote,2100"].join("\n"),
    );

    expect(plan.errors[0]?.message).toContain("can only have one price");
  });

  it("rejects a row that leaves an option value blank", () => {
    const plan = planFor(
      [
        "slug,name,variant_price_cents,option1_name,option1_value",
        "shirt,Shirt,2000,Size,Small",
        "shirt,Shirt,2100,Size,",
      ].join("\n"),
    );

    expect(plan.errors[0]).toMatchObject({ row: 3, column: "option1_value" });
  });

  it("rejects an option value with no option to belong to", () => {
    const plan = planFor(
      ["slug,name,variant_price_cents,option1_name,option1_value", "shirt,Shirt,2000,,Small"].join(
        "\n",
      ),
    );

    expect(plan.errors[0]).toMatchObject({ row: 2, column: "option1_value" });
  });

  it("rejects a gap in the option axes", () => {
    const plan = planFor(
      [
        "slug,name,variant_price_cents,option1_name,option1_value,option2_name,option2_value",
        "shirt,Shirt,2000,,,Colour,Blue",
      ].join("\n"),
    );

    expect(plan.errors.some((error) => error.column === "option1_name")).toBe(true);
  });

  it("names the row where a product's own fields disagree", () => {
    const plan = planFor(
      [
        "slug,name,variant_price_cents,option1_name,option1_value",
        "shirt,Shirt,2000,Size,Small",
        "shirt,Shirt Deluxe,2100,Size,Large",
      ].join("\n"),
    );

    expect(plan.errors[0]).toMatchObject({ row: 3, column: "name" });
  });

  it("treats a blank product field on a later row as “same as above”", () => {
    const plan = planFor(
      [
        "slug,name,variant_price_cents,option1_name,option1_value",
        "shirt,Shirt,2000,Size,Small",
        "shirt,,2100,,Large",
      ].join("\n"),
    );

    expect(plan.errors).toEqual([]);
    expect(plan.entries[0]?.input?.name).toBe("Shirt");
    expect(plan.entries[0]?.input?.options).toEqual([{ name: "Size", values: ["Small", "Large"] }]);
  });

  it("refuses a finite variant with no stock count", () => {
    const plan = planFor(
      "slug,name,variant_price_cents,variant_inventory_type,variant_inventory_quantity\ntote,Tote,2000,finite,\n",
    );

    expect(plan.errors[0]).toMatchObject({ row: 2, column: "variant_inventory_quantity" });
  });

  it("refuses a digital product carrying a stock count", () => {
    // productInputSchema's own rule, reached through the importer so the file
    // cannot create something the product editor would reject.
    const plan = planFor(
      [
        "slug,name,kind,variant_price_cents,variant_inventory_type,variant_inventory_quantity",
        "guide,Guide,digital,2000,finite,5",
      ].join("\n"),
    );

    expect(plan.errors[0]?.column).toBe("variant_inventory_quantity");
    expect(plan.errors[0]?.message).toContain("unlimited");
  });

  it("refuses a tax code that is not one", () => {
    const plan = planFor(
      "slug,name,variant_price_cents,tax_code\ntote,Tote,2000,VAT-20\n",
    );

    expect(plan.errors[0]).toMatchObject({ row: 2, column: "tax_code" });
  });
});
