import { storeSchema, type Store } from "@shared/schema";
import { demoStore } from "@shared/demo-store";

/**
 * The single seam between the storefront and its data.
 *
 * The store comes from the API. Set VITE_BELUGA_API=false to render the
 * bundled demo fixture instead, which is useful for UI work without a
 * database running. Both paths are validated by the same schema, which is
 * what let the data source change in Phase 2 without touching a component.
 */
export class StoreNotSetUpError extends Error {
  constructor() {
    super("This store has not been set up yet.");
    this.name = "StoreNotSetUpError";
  }
}

export async function loadStore(signal?: AbortSignal): Promise<Store> {
  if (import.meta.env.VITE_BELUGA_API !== "false") {
    const response = await fetch("/api/store", {
      ...(signal ? { signal } : {}),
      headers: { accept: "application/json" },
    });
    // 503 means "no store yet", which the setup wizard handles in Phase 5.
    if (response.status === 503) throw new StoreNotSetUpError();
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
