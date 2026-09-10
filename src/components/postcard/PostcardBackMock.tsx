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

export function PostcardBackMock({ back }: { back: PostcardBack }) {
  const fontPx = (back.fontSize / 72) * PX_PER_INCH;

  return (
    <div
      className={cx(styles.backCard)}
      style={{ width: CARD_WIDTH_PX, height: 4.25 * PX_PER_INCH }}
      aria-hidden
    >
      <div
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
