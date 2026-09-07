import type { Image } from "@shared/schema";
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

  return (
    <img
      className={`${styles.image} ${className ?? ""}`}
      style={style}
      src={assetUrl(image.path)}
      width={image.width}
      height={image.height}
      alt={image.alt}
      sizes={sizes}
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
      draggable={false}
    />
  );
}
