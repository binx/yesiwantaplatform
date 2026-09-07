import { storeSchema, type Store } from "@shared/schema";
import { demoStore } from "@/fixtures/demo-store";

/**
 * The single seam between the storefront and its data.
 *
 * Phase 1 validates and returns the bundled demo fixture. Phase 2 swaps the
 * body of `loadStore` for `GET /api/store` — the schema is the contract, so
 * no component or hook changes when that happens.
 */
export async function loadStore(signal?: AbortSignal): Promise<Store> {
  if (import.meta.env.VITE_BELUGA_API === "true") {
    const response = await fetch("/api/store", {
      ...(signal ? { signal } : {}),
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Could not load the store (HTTP ${response.status}).`);
    }
    return storeSchema.parse(await response.json());
  }

  // Parsed rather than cast, so a malformed fixture fails loudly in tests too.
  return storeSchema.parse(demoStore);
}

/** Resolve an image path from the schema to a URL the browser can request. */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}assets/${path}`;
}
