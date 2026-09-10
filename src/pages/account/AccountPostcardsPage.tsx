import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button, Skeleton } from "antd";
import { summariseDesign, type GalleryDesign } from "@shared/gallery";
import { ProductImage } from "@/components/ui/ProductImage";
import { useGallery } from "@/lib/gallery";
import { cx } from "@/lib/cx";
import account from "./Account.module.css";
import styles from "./Gallery.module.css";

/**
 * Everything this customer has designed, newest first, with where each
 * card went. Nobody thinks of what they sent as "order 7C3A91F2"; they
 * think of the photo of the dog, so this is a grid of photos.
 */
export function AccountPostcardsPage() {
  const gallery = useGallery();

  useEffect(() => {
    document.title = "Your postcards · Your account";
  }, []);

  if (gallery.isPending) return <Skeleton active paragraph={{ rows: 5 }} />;

  const designs = gallery.data?.pages.flatMap((page) => page.designs) ?? [];

  if (designs.length === 0) {
    return (
      <p className={cx(account.empty)}>
        Nothing designed yet. <Link to="/create">Make a postcard</Link>.
      </p>
    );
  }

  return (
    <div>
      <p className={cx(account.meta)}>
        Every postcard you have designed. Open one to see who it went to, and send it again to new
        people without uploading the photo twice.
      </p>

      <ul className={styles.grid} aria-label="Your postcards">
        {designs.map((design) => (
          <li key={design.id} className={styles.card}>
            <DesignCard design={design} />
          </li>
        ))}
      </ul>

      {gallery.hasNextPage ? (
        <Button onClick={() => void gallery.fetchNextPage()} loading={gallery.isFetchingNextPage}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}

export function DesignCard({ design }: { design: GalleryDesign }) {
  const excerpt = design.back.text.trim().split("\n")[0] || (design.ordered ? "No message" : "Draft");
  return (
    <Link to={`/account/postcards/${design.id}`} className={styles.cardLink}>
      <div className={styles.thumb}>
        <ProductImage image={design.thumbnail} sizes="(max-width: 600px) 50vw, 25vw" decorative />
      </div>
      <p className={styles.excerpt} style={{ fontFamily: `"${design.back.fontName}"` }}>
        {excerpt}
      </p>
      <p className={cx(styles.summary, design.postcards.error > 0 && styles.attention)}>{summariseDesign(design)}</p>
    </Link>
  );
}
