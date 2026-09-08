import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { ShippingRate, ShippingRateInput, ShippingZone, ShippingZoneInput } from "../shared/shipping.js";
import { taxBehaviorSchema } from "../shared/schema.js";
import { getDatabase } from "./client.js";

/**
 * Shipping zones and rates.
 *
 * Read together and written together: a shop owner edits a shipping table as
 * one thing, and a rate that references a zone being deleted in the same edit
 * has to be resolved in one transaction rather than across several requests.
 */

function jsonFor(isPg: boolean, value: unknown): unknown {
  return isPg ? value : JSON.stringify(value);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

interface ZoneRow {
  id: string;
  name: string;
  countryCodes: unknown;
  position: number;
}

interface RateRow {
  id: string;
  name: string;
  priceCents: number;
  zoneId: string | null;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
  minSubtotalCents: number | null;
  maxSubtotalCents: number | null;
  taxBehavior: string;
  isActive: unknown;
  position: number;
}

export interface ShippingTable {
  zones: ShippingZone[];
  rates: ShippingRate[];
}

export async function getShippingTable(): Promise<ShippingTable> {
  const { drizzle: db, schema } = await getDatabase();

  const [zoneRows, rateRows] = await Promise.all([
    db
      .select()
      .from(schema.shippingZones)
      .orderBy(asc(schema.shippingZones.position)) as unknown as Promise<ZoneRow[]>,
    db
      .select()
      .from(schema.shippingRates)
      .orderBy(asc(schema.shippingRates.position)) as unknown as Promise<RateRow[]>,
  ]);

  return {
    zones: zoneRows.map((row) => ({
      id: row.id,
      name: row.name,
      countryCodes: parseJson<string[]>(row.countryCodes, []).map((c) => c.toUpperCase()),
      position: row.position,
    })),
    rates: rateRows.map((row) => ({
      id: row.id,
      name: row.name,
      priceCents: row.priceCents,
      zoneId: row.zoneId,
      minWeightGrams: row.minWeightGrams,
      maxWeightGrams: row.maxWeightGrams,
      minSubtotalCents: row.minSubtotalCents,
      maxSubtotalCents: row.maxSubtotalCents,
      taxBehavior: taxBehaviorSchema.catch("exclusive").parse(row.taxBehavior),
      isActive: row.isActive === true || row.isActive === 1,
      position: row.position,
    })),
  };
}

/**
 * Replace the whole table.
 *
 * Wholesale rather than per-row because zones and rates are edited as one
 * form: a rate may point at a zone created in the same save, and a zone may be
 * deleted out from under a rate. Rebuilding both in order sidesteps the
 * ordering problem entirely.
 *
 * Client-supplied zone ids are remapped to server-generated ones, so nothing a
 * browser sends becomes a primary key.
 */
export async function replaceShippingTable(input: {
  zones: (ShippingZoneInput & { id?: string })[];
  rates: (ShippingRateInput & { id?: string })[];
}): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const json = (value: unknown) => jsonFor(dialect === "pg", value);

  // Rates reference zones, so they go first on the way out.
  await db.delete(schema.shippingRates);
  await db.delete(schema.shippingZones);

  /** Old id (or index) → the id actually written, so rates can be repointed. */
  const zoneIds = new Map<string, string>();

  for (const [position, zone] of input.zones.entries()) {
    const id = randomUUID();
    if (zone.id) zoneIds.set(zone.id, id);
    zoneIds.set(`index:${position}`, id);

    await db.insert(schema.shippingZones).values({
      id,
      name: zone.name,
      countryCodes: json(zone.countryCodes.map((c) => c.toUpperCase())),
      position,
    });
  }

  for (const [position, rate] of input.rates.entries()) {
    // A rate pointing at a zone that no longer exists becomes global rather
    // than being silently dropped — losing a rate costs the shop money.
    const zoneId = rate.zoneId ? (zoneIds.get(rate.zoneId) ?? null) : null;

    await db.insert(schema.shippingRates).values({
      id: randomUUID(),
      name: rate.name,
      priceCents: rate.priceCents,
      zoneId,
      minWeightGrams: rate.minWeightGrams,
      maxWeightGrams: rate.maxWeightGrams,
      minSubtotalCents: rate.minSubtotalCents,
      maxSubtotalCents: rate.maxSubtotalCents,
      taxBehavior: rate.taxBehavior,
      isActive: rate.isActive,
      position,
    });
  }
}

/** Variant weights, for computing a parcel's weight server-side. */
export async function variantWeights(variantIds: string[]): Promise<Map<string, number>> {
  const { drizzle: db, schema } = await getDatabase();
  if (variantIds.length === 0) return new Map();

  const rows = (await db
    .select({ id: schema.variants.id, weightGrams: schema.variants.weightGrams })
    .from(schema.variants)) as unknown as { id: string; weightGrams: number }[];

  return new Map(rows.filter((r) => variantIds.includes(r.id)).map((r) => [r.id, r.weightGrams]));
}

/** Used by the delete guard, mirroring the other repositories. */
export async function zoneExists(id: string): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ id: schema.shippingZones.id })
    .from(schema.shippingZones)
    .where(eq(schema.shippingZones.id, id))
    .limit(1)) as unknown as { id: string }[];
  return rows.length > 0;
}
