import { useEffect, useId, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Product } from "@shared/schema";
import { searchProducts, sortProducts, type SortOrder } from "@shared/catalog";
import { ProductList } from "./ProductList";
import styles from "./ProductBrowser.module.css";

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "name", label: "Name" },
];

function isSortOrder(value: string): value is SortOrder {
  return SORT_OPTIONS.some((option) => option.value === value);
}

interface ProductBrowserProps {
  products: Product[];
  /** Collection name, carried into the product page for its breadcrumb. */
  collection?: string;
  currency?: string;
  /** BCP 47, from the store. Passed to the grid so prices read the store's way. */
  locale?: string;
}

/**
 * Search and sort over an already-loaded catalogue.
 *
 * The filtering is deliberately client-side. The storefront does not page
 * through `/api/products`; it loads the whole catalogue once from `/api/store`
 * via `loadStore`, so filtering here is instant, costs no request, and works
 * against the bundled fixture with `VITE_BELUGA_API=false`.
 *
 * When a catalogue outgrows `STORE_SNAPSHOT_LIMIT` the swap is to
 * `GET /api/products?search=` — which already exists, with LIKE matching in
 * `listProducts` — behind `src/lib/store-source.ts`. That is the same seam
 * that absorbed the Phase 1 fixture to Phase 2 database change, so no component
 * here has to know.
 */
export function ProductBrowser({
  products,
  collection,
  currency = "USD",
  locale = "en-US",
}: ProductBrowserProps) {
  const [params, setParams] = useSearchParams();
  const searchId = useId();
  const sortId = useId();

  const query = params.get("q") ?? "";
  const rawSort = params.get("sort") ?? "featured";
  const sort: SortOrder = isSortOrder(rawSort) ? rawSort : "featured";

  // The input is uncontrolled by the URL while typing: writing every keystroke
  // through useSearchParams would re-render the whole grid per character.
  const [draft, setDraft] = useState(query);

  // Adopt a query arriving from outside — a shared ?q= link, or the back button.
  useEffect(() => setDraft(query), [query]);

  useEffect(() => {
    if (draft === query) return;

    const timer = setTimeout(() => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (draft.trim()) next.set("q", draft);
          else next.delete("q");
          return next;
        },
        // Typing must not fill the history stack; one back should undo the
        // whole search, not the last keystroke.
        { replace: true },
      );
    }, 150);

    return () => clearTimeout(timer);
  }, [draft, query, setParams]);

  const matched = searchProducts(products, query);
  const shown = sortProducts(matched, sort);

  return (
    <>
      <div className={styles.controls}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={searchId}>
            Search
          </label>
          <input
            id={searchId}
            className={styles.input}
            type="search"
            value={draft}
            placeholder="Tote, mug, print…"
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={sortId}>
            Sort by
          </label>
          <select
            id={sortId}
            className={styles.select}
            value={sort}
            onChange={(event) =>
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                if (event.target.value === "featured") next.delete("sort");
                else next.set("sort", event.target.value);
                return next;
              })
            }
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Announced rather than only shown, so the result of typing is not
      invisible to a screen reader. */}
      <p className={styles.count} aria-live="polite">
        {query.trim()
          ? `${shown.length} ${shown.length === 1 ? "product" : "products"} matching “${query}”`
          : `${shown.length} ${shown.length === 1 ? "product" : "products"}`}
      </p>

      {query.trim() && shown.length === 0 ? (
        <div className={styles.empty}>
          <button
            type="button"
            className={styles.clear}
            onClick={() =>
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                next.delete("q");
                return next;
              })
            }
          >
            Show everything
          </button>
        </div>
      ) : (
        <ProductList
          products={shown}
          {...(collection ? { collection } : {})}
          currency={currency}
          locale={locale}
        />
      )}
    </>
  );
}
