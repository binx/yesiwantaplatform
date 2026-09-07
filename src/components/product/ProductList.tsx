import { Link } from "react-router-dom";
import type { Product } from "@shared/schema";
import { getProductPrices, isSoldOut } from "@shared/catalog";
import { formatPriceRange } from "@shared/money";
import { ProductImage } from "@/components/ui/ProductImage";
import styles from "./ProductList.module.css";

interface ProductListProps {
  products: Product[];
  /** Collection name, carried into the product page for its breadcrumb. */
  collection?: string;
  currency?: string;
}

export function ProductList({ products, collection, currency = "USD" }: ProductListProps) {
  if (products.length === 0) {
    return <p className={styles.empty}>Nothing here yet.</p>;
  }

  return (
    <ul className={styles.grid}>
      {products.map((product) => {
        const price = formatPriceRange(getProductPrices(product), currency);
        const soldOut = isSoldOut(product);

        return (
          <li key={product.id}>
            <Link
              to={`/product/${product.slug}`}
              state={collection ? { collection } : null}
              className={styles.card}
            >
              <div className={styles.frame}>
                <ProductImage
                  image={product.images[0] ?? null}
                  ratio={3 / 4}
                  sizes="(max-width: 650px) 100vw, (max-width: 1100px) 50vw, 33vw"
                />
                {soldOut && <span className={styles.badge}>Sold out</span>}
              </div>
              <span className={styles.name}>{product.name}</span>
              {price && <span className={styles.price}>{price}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
