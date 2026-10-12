import { Link } from "react-router-dom";
import { Tag } from "antd";
import { artistPath, editionPath, type ArtistSummary, type EditionSummary } from "@shared/platform";
import { formatMoney } from "@shared/money";
import type { Image } from "@shared/schema";
import { ProductImage } from "@/components/ui/ProductImage";
import { editionShape } from "@/lib/postcards";
import { cx } from "@/lib/cx";
import styles from "./Platform.module.css";

/**
 * One artist in a grid: their newest edition's banner (or their face, when
 * none has one), their name, how many editions they have on sale. Never a
 * card: the cards are the surprise.
 *
 * The whole tile is one link, so a screen reader hears the name once; the
 * picture is decorative because the name beside it is the name.
 */
export function ArtistTile({ artist }: { artist: ArtistSummary }) {
  const available = artist.editionCount === 0 ? null : `${artist.editionCount} ${artist.editionCount === 1 ? "edition" : "editions"} available`;
  return (
    <Link to={artistPath(artist.slug)} className={cx(styles.tile)}>
      <div className={styles.tileImage}>
        <ProductImage image={artist.banner ?? artist.avatar} ratio={artist.banner ? 3 : 3 / 2} sizes="(max-width: 800px) 100vw, 33vw" decorative />

      </div>
      <div className={styles.tileBody}>
        <div className={styles.tileHead}>
          {artist.avatar ? <img className={styles.tileAvatar} src={`/assets/${artist.avatar.path}`} alt="" width={40} height={40} /> : null}
          <div>
            <p className={styles.tileName}>{artist.name}</p>
          </div>
        </div>
        {available ? <p className={styles.tileMeta}>{available}</p> : null}
      </div>
    </Link>
  );
}

/**
 * One edition in a grid: its banner, its name, its shape and its price, and
 * — when it is among other artists' editions — whose it is. The whole tile
 * is the link. No banner, no picture: the cards are a surprise, so there is
 * nothing else to show.
 *
 * On an artist's own page the artist is understood, so only their slug is
 * passed and the tile is just the edition.
 */
export function EditionTile({ edition, artist, locale }: { edition: EditionSummary; artist: { slug: string; name?: string; avatar?: Image | null }; locale: string }) {
  return (
    <Link to={editionPath(artist.slug, edition.slug)} className={cx(styles.tile, !edition.banner && styles.tilePlain)}>
      {edition.banner ? (
        <div className={styles.tileImage}>
          <ProductImage image={edition.banner} ratio={3} sizes="(max-width: 800px) 100vw, 33vw" decorative />
        </div>
      ) : null}
      <div className={styles.tileBody}>
        <div className={styles.tileHead}>
          {artist.avatar ? <img className={styles.tileAvatar} src={`/assets/${artist.avatar.path}`} alt="" width={40} height={40} /> : null}

          <div>
            <p className={styles.tileName}>
              {edition.title} {edition.status === "closed" ? <Tag className={cx(styles.closedTag)}>Closed</Tag> : null}
            </p>
            {artist.name ? <p className={styles.tileTagline}>by {artist.name}</p> : null}
          </div>
        </div>
        <p className={styles.tileMeta}>
          {editionShape(edition.cardCount)} · <strong>{formatMoney(edition.priceCents, edition.currency, locale)}</strong>
        </p>
      </div>
    </Link>
  );
}
