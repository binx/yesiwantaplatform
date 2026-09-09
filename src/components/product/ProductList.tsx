import type { Product } from "@shared/schema";
import { getProductPrices, isSoldOut } from "@shared/catalog";
import { formatPriceRange } from "@shared/money";
import { ProductCard } from "./ProductCard";
import styles from "./ProductList.module.css";

interface ProductListProps {
  products: Product[];
  /** Collection name, carried into the product page for its breadcrumb. */
  collection?: string;
  currency?: string;
  /** BCP 47, from the store. Decides where the separators in a price go. */
  locale?: string;
}

export function ProductList({
  products,
  collection,
  currency = "USD",
  locale = "en-US",
}: ProductListProps) {
  if (products.length === 0) {
    return <p className={styles.empty}>Nothing here yet.</p>;
  }

  return (
    <ul className={styles.grid}>
      {products.map((product) => {
        const price = formatPriceRange(getProductPrices(product), currency, locale);
        const soldOut = isSoldOut(product);

        return (
          <li key={product.id}>
            <ProductCard
              href={`/product/${product.slug}`}
              name={product.name}
              price={price}
              soldOut={soldOut}
              image={product.images[0] ?? null}
              sizes="(max-width: 650px) 100vw, (max-width: 1100px) 50vw, 33vw"
              collection={collection}
            />
          </li>
        );
      })}
    </ul>
  );
}
