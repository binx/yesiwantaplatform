import { Link } from "react-router-dom";
import type { Image } from "@shared/schema";
import { ProductImage } from "@/components/ui/ProductImage";
import styles from "./ProductCard.module.css";

/**
 * One product, as the storefront grid draws it.
 *
 * Presentational on purpose: it takes a name and a price string rather than a
 * `Product`, so the theme editor can render a real card next to the colour
 * pickers without inventing a whole catalogue entry. The editor used to preview
 * a bespoke antd Card instead, which is how it ended up advertising an accent
 * colour the storefront never used.
 */
interface ProductCardProps {
  href: string;
  name: string;
  /** Preformatted — callers own currency and range formatting. */
  price: string | null;
  soldOut?: boolean;
  image?: Image | null;
  sizes?: string | undefined;
  /** Carried into the product page for its breadcrumb. */
  collection?: string | undefined;
}

export function ProductCard({
  href,
  name,
  price,
  soldOut = false,
  image = null,
  sizes,
  collection,
}: ProductCardProps) {
  return (
    <Link
      to={href}
      state={collection ? { collection } : null}
      className={styles.card}
    >
      <div className={styles.frame}>
        <ProductImage image={image} ratio={3 / 4} {...(sizes ? { sizes } : {})} />
        {soldOut && <span className={styles.badge}>Sold out</span>}
      </div>
      <span className={styles.name}>{name}</span>
      {price && <span className={styles.price}>{price}</span>}
    </Link>
  );
}
