import { Link } from "react-router-dom";
import { Alert, Skeleton } from "antd";
import type { ReceivedPostcard } from "@shared/platform";
import { useReceivedPostcards } from "@/lib/account";
import { useStore } from "@/lib/useStore";
import { ProductImage } from "@/components/ui/ProductImage";
import { customerStatusLabel, formatMailDate, trackingLabel } from "@/lib/postcards";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

/**
 * Every card mailed to this person, newest first, with where each one is.
 *
 * Tracking is shown here and nowhere else: a subscriber opted into a
 * postcard, not a feed of USPS scans, so the timeline sits under the card
 * for whoever comes looking and is never emailed.
 */
export function AccountPostcardsPage() {
  const store = useStore();
  const postcards = useReceivedPostcards();


  if (postcards.isPending) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (postcards.isError) return <Alert type="error" showIcon title="Your postcards could not be loaded." />;

  if (postcards.data.length === 0) {
    return (
      <p className={cx(styles.empty)}>
        Nothing has been mailed to you yet. When an artist you subscribe to sends their monthly card, it shows up here. <Link to="/artists">Find an artist</Link>.
      </p>
    );
  }

  return (
    <ul className={styles.postcardList}>
      {postcards.data.map((card) => (
        <PostcardRow key={card.id} card={card} locale={store.locale} />
      ))}
    </ul>
  );
}

function PostcardRow({ card, locale }: { card: ReceivedPostcard; locale: string }) {
  const day = (epochMs: number) => new Date(epochMs).toLocaleDateString(locale, { month: "short", day: "numeric" });
  return (
    <li className={styles.postcardRow}>
      <div className={styles.postcardThumb}>
        <ProductImage image={card.design.thumbnail} sizes="160px" />
      </div>
      <div className={styles.postcardBody}>
        <p className={styles.postcardTitle}>
          {card.title ? <strong>{card.title}</strong> : <strong>A postcard</strong>} from <Link to={`/artist/${card.artist.slug}`}>{card.artist.name}</Link>
        </p>
        <p className={cx(styles.meta)}>
          {formatMailDate(card.mailDate, locale)} · {customerStatusLabel(card.status)}
          {card.status === "sent" && card.expectedDeliveryDate && card.trackingStatus !== "postcard.delivered" ? ` · expected ${formatMailDate(card.expectedDeliveryDate, locale)}` : ""}
        </p>
        {card.design.back.text ? (
          <p className={styles.postcardNote} style={{ fontFamily: `"${card.design.back.fontName}", cursive` }}>
            {card.design.back.text}
            {card.design.back.valediction ? <span className={styles.postcardValediction}>{card.design.back.valediction}</span> : null}
          </p>
        ) : null}
        {card.tracking.length > 0 ? (
          <ol className={styles.timeline} aria-label="Delivery progress">
            {card.tracking.map((event) => (
              <li key={`${event.type}-${event.occurredAt}`} className={cx(styles.timelineStep, event.type === "postcard.returned_to_sender" && styles.timelineBad)}>
                <span className={styles.timelineDay}>{day(event.occurredAt)}</span>
                <span>{trackingLabel(event.type)}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </li>
  );
}
