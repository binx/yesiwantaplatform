import { useLayoutEffect, useRef, useState } from "react";
import { stripEmoji, type PostcardBack } from "@shared/postcards";
import { cx } from "@/lib/cx";
import styles from "./Postcard.module.css";

/**
 * The back of the card, as it will print.
 *
 * Drawn at a fixed width and scaled from inches, so the proportions match
 * `print/back.hbs`: a 6.25in × 4.25in card, a 2.8in column for the message
 * inside the safe area, and the rest left for the address Lob prints. The
 * font size is in points on the card and scaled by the same factor here,
 * which is what keeps "24" meaning the same thing on screen and on paper.
 *
 * Narrower than that — a phone — the whole card is transformed down to the
 * width it has, inside a frame that keeps the card's shape in the layout.
 */
const CARD_WIDTH_PX = 468;
const CARD_HEIGHT_PX = 4.25 * (CARD_WIDTH_PX / 6.25);
const PX_PER_INCH = CARD_WIDTH_PX / 6.25;

interface PostcardBackMockProps {
  back: PostcardBack;
  /** The line printed under the message: the artist's name. */
  artistName?: string;
  /** Called whenever the message column's content fits or stops fitting. */
  onFit?: (fits: boolean) => void;
}

export function PostcardBackMock({ back, artistName = "You", onFit }: PostcardBackMockProps) {
  const fontPx = (back.fontSize / 72) * PX_PER_INCH;
  const textRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // The frame is as wide as its column lets it be, up to the card's own width.
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;

    const measure = () => {
      // jsdom measures 0; leave the card unscaled rather than invisible.
      const width = el.clientWidth;
      setScale(width > 0 ? Math.min(1, width / CARD_WIDTH_PX) : 1);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || !onFit) return;

    const measure = () => onFit(el.scrollHeight <= el.clientHeight + 1);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);

    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) measure();
    });

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [back, onFit]);

  return (
    <div ref={frameRef} className={styles.backFrame} style={{ maxWidth: CARD_WIDTH_PX, aspectRatio: `${CARD_WIDTH_PX} / ${CARD_HEIGHT_PX}` }} aria-hidden>
      <div className={cx(styles.backCard)} style={{ width: CARD_WIDTH_PX, height: CARD_HEIGHT_PX, transform: `scale(${scale})` }}>
        <div
          ref={textRef}
          className={cx(styles.backText)}
          style={{
            left: 0.25 * PX_PER_INCH,
            top: 0.25 * PX_PER_INCH,
            width: 2.8 * PX_PER_INCH,
            height: 3.75 * PX_PER_INCH,
            paddingRight: 0.1 * PX_PER_INCH,
            fontFamily: `"${back.fontName}", cursive`,
            fontSize: fontPx,
            color: back.fontColor,
          }}
        >
          <div className={styles.backMessage}>{stripEmoji(back.text)}</div>
          {back.valediction ? <div className={styles.backValediction}>{stripEmoji(back.valediction)}</div> : null}
          <div className={styles.backFooter} style={{ paddingTop: 0.1 * PX_PER_INCH }}>
            <strong>{stripEmoji(artistName)}</strong> · a monthly postcard via yesiwantapostcard.com
          </div>
        </div>
        <div className={styles.backAddress} style={{ right: 0.3 * PX_PER_INCH, bottom: 0.4 * PX_PER_INCH, width: 2.6 * PX_PER_INCH }}>
          <span />
          <span />
          <span />
        </div>
        <div className={styles.backStamp} style={{ right: 0.3 * PX_PER_INCH, top: 0.3 * PX_PER_INCH }} />
      </div>
    </div>
  );
}
