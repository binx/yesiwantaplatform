import { useCallback, useEffect, useId, useRef, useState } from "react";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import type { Image } from "@shared/schema";
import { assetUrl } from "@/lib/store-source";
import { ProductImage } from "@/components/ui/ProductImage";
import styles from "./Carousel.module.css";

interface CarouselProps {
  images: Image[];
  productName: string;
}

/**
 * Product image carousel.
 *
 * Replaces v1's split Carousel/MobileCarousel pair, which picked between
 * themselves with MUI's removed `withWidth` HOC and relied on the unmaintained
 * `react-swipeable-views` for touch. Swiping here is native CSS scroll-snap,
 * so there is no gesture library, and the slides are real <img> elements that
 * lazy-load and carry alt text.
 */
export function Carousel({ images, productName }: CarouselProps) {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const labelId = useId();

  const count = images.length;

  // Track which slide is in view so the thumbnails follow a manual swipe.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || count < 2) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;

        const index = slideRefs.current.indexOf(visible.target as HTMLDivElement);
        if (index !== -1) setActive(index);
      },
      { root: track, threshold: 0.6 },
    );

    for (const slide of slideRefs.current) {
      if (slide) observer.observe(slide);
    }
    return () => observer.disconnect();
  }, [count]);

  const goTo = useCallback((index: number) => {
    const slide = slideRefs.current[index];
    if (!slide) return;

    setActive(index);
    slide.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (count < 2) return;

    if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(Math.min(active + 1, count - 1));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(Math.max(active - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      goTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      goTo(count - 1);
    }
  };

  if (count === 0) {
    return <ProductImage image={null} ratio={3 / 4} />;
  }

  if (count === 1) {
    return <ProductImage image={images[0] ?? null} priority sizes="(max-width: 900px) 100vw, 55vw" />;
  }

  return (
    <div className={styles.carousel}>
      <div className={styles.stage}>
        <div
          ref={trackRef}
          className={styles.track}
          // Arrow keys need a focusable region; the group role names it.
          tabIndex={0}
          role="group"
          aria-roledescription="carousel"
          aria-labelledby={labelId}
          onKeyDown={onKeyDown}
        >
          <span id={labelId} className="sr-only">
            {productName} images. Use the left and right arrow keys to browse.
          </span>

          {images.map((image, index) => (
            <div
              key={image.path}
              ref={(el) => {
                slideRefs.current[index] = el;
              }}
              className={styles.slide}
              role="group"
              aria-roledescription="slide"
              aria-label={`${index + 1} of ${count}`}
            >
              <ProductImage
                image={image}
                priority={index === 0}
                sizes="(max-width: 900px) 100vw, 55vw"
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          className={`${styles.arrow} ${styles.prev}`}
          onClick={() => goTo(active - 1)}
          disabled={active === 0}
          aria-label="Previous image"
        >
          <LeftOutlined aria-hidden />
        </button>
        <button
          type="button"
          className={`${styles.arrow} ${styles.next}`}
          onClick={() => goTo(active + 1)}
          disabled={active === count - 1}
          aria-label="Next image"
        >
          <RightOutlined aria-hidden />
        </button>
      </div>

      {/* Announced politely so screen reader users get position without focus moves. */}
      <p aria-live="polite" className="sr-only">
        Image {active + 1} of {count}
      </p>

      <div className={styles.thumbs} role="tablist" aria-label={`${productName} images`}>
        {images.map((image, index) => (
          <button
            key={image.path}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-label={`Show image ${index + 1}: ${image.alt}`}
            tabIndex={index === active ? 0 : -1}
            className={index === active ? `${styles.thumb} ${styles.thumbActive}` : styles.thumb}
            onClick={() => goTo(index)}
            onKeyDown={onKeyDown}
          >
            <img src={assetUrl(image.path)} alt="" loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
    </div>
  );
}
