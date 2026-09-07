import { useSuspenseQuery } from "@tanstack/react-query";
import type { Store } from "@shared/schema";
import { loadStore } from "./store-source";

export const storeQueryKey = ["store"] as const;

export const storeQueryOptions = {
  queryKey: storeQueryKey,
  queryFn: ({ signal }: { signal: AbortSignal }) => loadStore(signal),
  staleTime: 5 * 60 * 1000,
};

/**
 * The store config, guaranteed present.
 *
 * v1 hydrated Redux from a JSON import and then guarded `if (!config) return null`
 * in App, which left every child unsure whether config existed. Suspense makes
 * the loaded store non-nullable at the type level instead.
 */
export function useStore(): Store {
  const { data } = useSuspenseQuery(storeQueryOptions);
  return data;
}
