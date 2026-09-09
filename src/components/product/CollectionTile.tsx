import { Link } from "react-router-dom";
import type { Collection } from "@shared/schema";
import { ProductImage } from "@/components/ui/ProductImage";
import styles from "./CollectionTile.module.css";

interface CollectionTileProps {
  collection: Pick<Collection, "slug" | "name" | "cover">;
  sizes?: string;
}

/**
 * One collection, as both `/shop` and the landing page draw it.
 *
 * `/shop` rendered its cover at 16:9 with the name beneath; the landing page
 * rendered a white box with the name centred, cover or no cover. On a dark
 * scheme that box read as a hole in the page, and a merchant who set a cover
 * (task 21 made it editable) saw it appear on one page and not the other. One
 * component means the two can only ever agree.
 *
 * The text-only fallback stays for a collection with no cover — what a
 * brand-new store shows, before anyone has uploaded one.
 */
export function CollectionTile({ collection, sizes }: CollectionTileProps) {
  if (!collection.cover) {
    return (
      <Link to={`/collection/${collection.slug}`} className={styles.fallback}>
        <h3 className={styles.fallbackName}>{collection.name}</h3>
      </Link>
    );
  }

  return (
    <Link to={`/collection/${collection.slug}`} className={styles.card}>
      <ProductImage
        image={collection.cover}
        ratio={16 / 9}
        {...(sizes ? { sizes } : {})}
        decorative
      />
      <h3 className={styles.name}>{collection.name}</h3>
    </Link>
  );
}
