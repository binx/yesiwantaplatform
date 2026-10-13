import { useLayoutEffect, useRef, useState } from "react";
import { CARD_FONT, stripEmoji } from "@shared/postcards";
import styles from "./Postcard.module.css";

/**
 * The back of the card, as it will print.
 *
 * Drawn at a fixed width and scaled from inches, so the proportions match
 * `print/back.hbs`: a 6.25in × 4.25in card, a 2.8in column for the caption
 * inside the safe area, and the rest left for the address Lob prints. The
 * caption is set in points on the card and scaled by the same factor here,
 * which is what keeps it the same size on screen and on paper.
 *
 * Narrower than that — a phone — the whole card is transformed down to the
 * width it has, inside a frame that keeps the card's shape in the layout.
 */
const CARD_WIDTH_PX = 468;
const CARD_HEIGHT_PX = 4.25 * (CARD_WIDTH_PX / 6.25);
const PX_PER_INCH = CARD_WIDTH_PX / 6.25;
const inches = (value: number) => value * PX_PER_INCH;
const points = (value: number) => (value / 72) * PX_PER_INCH;

interface PostcardBackMockProps {
  /** The title of the piece, as the artist is typing it. Empty leaves the line out. */
  title: string;
  artistName: string;
  siteName: string;
}

export function PostcardBackMock({ title, artistName, siteName }: PostcardBackMockProps) {
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

  return (
    <div ref={frameRef} className={styles.backFrame} style={{ maxWidth: CARD_WIDTH_PX, aspectRatio: `${CARD_WIDTH_PX} / ${CARD_HEIGHT_PX}` }} aria-hidden>
      <div className={styles.backCard} style={{ width: CARD_WIDTH_PX, height: CARD_HEIGHT_PX, transform: `scale(${scale})` }}>
        <div
          className={styles.backColumn}
          style={{
            left: inches(0.25),
            top: inches(0.25),
            width: inches(2.8),
            height: inches(3.75),
            paddingRight: inches(0.15),
            fontFamily: `"${CARD_FONT}", serif`,
            fontSize: points(9.5),
          }}
        >
          {title.trim() ? <div className={styles.backTitle}>{stripEmoji(title)}</div> : null}
          <div>{stripEmoji(artistName)}</div>
          <div className={styles.backSite} style={{ fontSize: points(7), marginTop: inches(0.06) }}>
            A postcard edition from {siteName}
          </div>
        </div>
        <div className={styles.backAddress} style={{ right: inches(0.3), bottom: inches(0.4), width: inches(2.6) }}>
          <span />
          <span />
          <span />
        </div>
        <div className={styles.backStamp} style={{ right: inches(0.3), top: inches(0.3) }} />
      </div>
    </div>
  );
}
