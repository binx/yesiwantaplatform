import type { Image } from "@shared/schema";
import { buildSrcSet } from "@shared/images";
import { assetUrl } from "@/lib/store-source";
import styles from "./ProductImage.module.css";

interface ProductImageProps {
  image: Image | null;
  /** Overrides the image's intrinsic ratio, e.g. to align cards in a grid. */
  ratio?: number;
  sizes?: string;
  priority?: boolean;
  className?: string;
}

/**
 * A real <img>, not a background-image div.
 *
 * v1 painted every product photo as a CSS background on a <div>, so none of the
 * imagery had alt text, none of it appeared to screen readers or search
 * engines, and none of it could lazy-load. It also faked aspect ratios with
 * percentage bottom-padding; `aspect-ratio` does that natively now.
 */
export function ProductImage({
  image,
  ratio,
  sizes = "100vw",
  priority = false,
  className,
}: ProductImageProps) {
  const style = { aspectRatio: ratio ?? (image ? image.width / image.height : 1) };

  if (!image) {
    // v1 emitted `background-image: url(null)`, costing a 404 per missing image.
    return (
      <div
        className={`${styles.placeholder} ${className ?? ""}`}
        style={style}
        role="img"
        aria-label="No image available"
      />
    );
  }

  /*
   * `srcset` lists what actually exists, `sizes` says how wide it will render,
   * and the browser downloads the smallest file that is still sharp at the
   * viewer's pixel density.
   *
   * Both are needed: until derivatives existed this component passed `sizes`
   * alone, which does nothing without a `srcset` to choose from — so every
   * visitor got the full-size file, and a phone showing a card 180px wide
   * still downloaded 2400px of image.
   *
   * An image uploaded before derivatives has an empty `widths` and falls back
   * to the single full-size file rather than advertising URLs that would 404.
   */
  const srcSet = buildSrcSet(image, assetUrl);

  return (
    <img
      className={`${styles.image} ${className ?? ""}`}
      style={style}
      src={assetUrl(image.path)}
      {...(srcSet ? { srcSet, sizes } : {})}
      width={image.width}
      height={image.height}
      alt={image.alt}
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
      draggable={false}
    />
  );
}
