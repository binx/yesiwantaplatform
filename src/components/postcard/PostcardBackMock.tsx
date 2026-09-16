import { useLayoutEffect, useRef } from "react";
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
 */
const CARD_WIDTH_PX = 468;
const PX_PER_INCH = CARD_WIDTH_PX / 6.25;

interface PostcardBackMockProps {
  back: PostcardBack;
  replyLink?: boolean;
  /** Called whenever the message column's content fits or stops fitting. */
  onFit?: (fits: boolean) => void;
}

export function PostcardBackMock({ back, replyLink = false, onFit }: PostcardBackMockProps) {
  const fontPx = (back.fontSize / 72) * PX_PER_INCH;
  const textRef = useRef<HTMLDivElement>(null);

  /*
   * The column's height is fixed (an inch measurement, not content-driven),
   * so typing more text never changes its own box — ResizeObserver alone
   * would never fire. It still matters for what *does* change the box: the
   * phone layout scales the card (brief 14 in docs/NEXT-STEPS.md §6). `back`
   * as a dependency is what catches a longer note; fonts.ready is what
   * catches a face that was still loading when this first measured, since a
   * fallback face wraps differently than the one that landed a moment later.
   */
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
    <div
      className={cx(styles.backCard)}
      style={{ width: CARD_WIDTH_PX, height: 4.25 * PX_PER_INCH }}
      aria-hidden
    >
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
        {replyLink ? (
          // The QR itself is drawn at print time from the card's own code; this is its footprint.
          <div className={styles.backReply} style={{ paddingTop: 0.1 * PX_PER_INCH }}>
            <div className={styles.backQr} style={{ width: 0.6 * PX_PER_INCH, height: 0.6 * PX_PER_INCH }} />
            <span className={styles.backReplyCaption}>
              Scan to send your own postcard
              <span className={styles.backReplyUrl}>postcardgifts.com</span>
            </span>
          </div>
        ) : null}
      </div>
      <div
        className={styles.backAddress}
        style={{ right: 0.3 * PX_PER_INCH, bottom: 0.4 * PX_PER_INCH, width: 2.6 * PX_PER_INCH }}
      >
        <span />
        <span />
        <span />
      </div>
      <div className={styles.backStamp} style={{ right: 0.3 * PX_PER_INCH, top: 0.3 * PX_PER_INCH }} />
    </div>
  );
}
