import { Link } from "react-router-dom";
import type { ArtistSummary, GalleryCard } from "@shared/platform";
import { formatMoney } from "@shared/money";
import { ProductImage } from "@/components/ui/ProductImage";
import { formatShortDate } from "@/lib/postcards";
import { cx } from "@/lib/cx";
import styles from "./Platform.module.css";

/**
 * One artist in a grid: their latest card, their face, their price.
 *
 * The whole tile is one link, so a screen reader hears the name once; the
 * picture is decorative because the name beside it is the name.
 */
export function ArtistTile({ artist, locale }: { artist: ArtistSummary; locale: string }) {
  const price = formatMoney(artist.monthlyPriceCents, artist.currency, locale);
  return (
    <Link to={`/a/${artist.slug}`} className={cx(styles.tile)}>
      <div className={styles.tileImage}>
        <ProductImage image={artist.latest?.thumbnail ?? artist.avatar} {...(artist.latest ? {} : { ratio: 3 / 2 })} sizes="(max-width: 800px) 100vw, 33vw" decorative />
      </div>
      <div className={styles.tileBody}>
        <div className={styles.tileHead}>
          {artist.avatar ? <img className={styles.tileAvatar} src={`/assets/${artist.avatar.path}`} alt="" width={40} height={40} /> : null}
          <div>
            <p className={styles.tileName}>{artist.name}</p>
            {artist.tagline ? <p className={styles.tileTagline}>{artist.tagline}</p> : null}
          </div>
        </div>
        <p className={styles.tileMeta}>
          <strong>{price}</strong> a month · {artist.subscriberCount} {artist.subscriberCount === 1 ? "subscriber" : "subscribers"}
        </p>
      </div>
    </Link>
  );
}

/** One mailed card in the gallery: the front, who, when. */
export function GalleryTile({ card, locale, showArtist = true }: { card: GalleryCard; locale: string; showArtist?: boolean }) {
  return (
    <figure className={cx(styles.galleryTile)}>
      <div className={styles.galleryImage}>
        <ProductImage image={card.design.thumbnail} sizes="(max-width: 800px) 50vw, 25vw" />
      </div>
      <figcaption className={styles.galleryCaption}>
        {card.title ? <span className={styles.galleryTitle}>{card.title}</span> : null}
        <span className={styles.galleryMeta}>
          {showArtist ? (
            <>
              <Link to={`/a/${card.artist.slug}`}>{card.artist.name}</Link> ·{" "}
            </>
          ) : null}
          mailed {formatShortDate(card.mailDate, locale)}
        </span>
      </figcaption>
    </figure>
  );
}
