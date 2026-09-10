import type { ReactNode } from "react";
import type { Order } from "@shared/orders";
import { Button, Popconfirm } from "antd";
import { formatRecipient, type Postcard, type PostcardStatus } from "@shared/postcards";
import { ProductImage } from "@/components/ui/ProductImage";
import { cx } from "@/lib/cx";
import { customerStatusLabel, formatMailDate, trackingLabel } from "@/lib/postcards";
import styles from "./Postcard.module.css";

/**
 * Every card on an order, with where it is.
 *
 * Shared by the confirmation page and the account's order detail — the same
 * table a buyer sees in both places, so what an email link lands on and what
 * their account shows never disagree. The admin has its own, with the error
 * text and the buttons.
 */
/**
 * Where a sent card is, scan by scan, oldest first. Rendered under the
 * status wherever an order is shown — the confirmation page, the account,
 * the admin — and nowhere else: the sender opted into a confirmation and a
 * "went to print" note, not a feed of USPS scans.
 */
export function TrackingTimeline({ postcard, locale }: { postcard: Postcard; locale: string }) {
  if (postcard.tracking.length === 0) return null;
  const day = (epochMs: number) => new Date(epochMs).toLocaleDateString(locale, { month: "short", day: "numeric" });

  return (
    <ol className={styles.timeline} aria-label="Delivery progress">
      {postcard.tracking.map((event) => (
        <li key={`${event.type}-${event.occurredAt}`} className={cx(styles.timelineStep, event.type === "postcard.returned_to_sender" && styles.statusError)}>
          <span className={styles.timelineDay}>{day(event.occurredAt)}</span>
          <span>{trackingLabel(event.type)}</span>
        </li>
      ))}
    </ol>
  );
}

function statusClass(status: PostcardStatus): string {
  if (status === "sent") return styles.statusSent ?? "";
  if (status === "error") return styles.statusError ?? "";
  if (status === "cancelled") return styles.statusCancelled ?? "";
  return "";
}

/**
 * What came back through the card's QR: the recipient's tap and note, and
 * a reply on its way — shown without its front until it has landed.
 */
export function ReplyNotes({ postcard, locale }: { postcard: Postcard; locale: string }) {
  const { reaction, replies } = postcard;
  if (!reaction && !replies) return null;
  const day = (epochMs: number) => new Date(epochMs).toLocaleDateString(locale, { month: "short", day: "numeric" });
  return (
    <div className={styles.replyNotes}>
      {reaction ? (
        <div>
          <span className={styles.reactionEmoji}>{reaction.emoji}</span> {reaction.note ? `“${reaction.note}”` : "It arrived"}{" "}
          <span className={styles.note}>{day(reaction.at)}</span>
        </div>
      ) : null}
      {replies && replies.onTheWay > 0 ? <div className={styles.note}>A reply is on its way</div> : null}
      {replies && replies.delivered > 0 ? (
        <div className={styles.replyBack}>
          {replies.thumbnail ? (
            <div className={styles.scheduleThumb}>
              <ProductImage image={replies.thumbnail} sizes="64px" decorative />
            </div>
          ) : null}
          <span className={styles.note}>They sent one back</span>
        </div>
      ) : null}
    </div>
  );
}

export function PostcardSchedule({
  order,
  locale,
  renderStatus,
  onDisableReply,
}: {
  order: Pick<Order, "postcards" | "designs">;
  locale: string;
  /** The admin passes its own cell; the storefront gets the plain label. */
  renderStatus?: (postcard: Postcard) => ReactNode;
  /** The sender's own order page offers to turn a card's code off. */
  onDisableReply?: (postcard: Postcard) => void;
}) {
  const designs = new Map(order.designs.map((design) => [design.id, design]));

  return (
    <div className={styles.tableScroll}>
      <table className={styles.scheduleTable}>
        <thead>
          <tr>
            <th scope="col">Design</th>
            <th scope="col">To</th>
            <th scope="col">Mailed on</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {order.postcards.map((postcard) => {
            const design = designs.get(postcard.designId);
            return (
              <tr key={postcard.id}>
                <td>
                  <div className={styles.scheduleThumb}>
                    <ProductImage image={design?.thumbnail ?? null} sizes="64px" decorative />
                  </div>
                </td>
                <td>
                  <div>{postcard.recipient.name}</div>
                  <div className={styles.note}>{postcard.isReply ? "Address kept private" : formatRecipient(postcard.recipient, locale)}</div>
                  <ReplyNotes postcard={postcard} locale={locale} />
                  {onDisableReply && postcard.replyCode && postcard.status !== "cancelled" ? (
                    <Popconfirm title="Turn off this card's QR code?" description="The page behind it goes dark and nobody can reply through it. This can't be undone." onConfirm={() => onDisableReply(postcard)}>
                      <Button type="link" size="small" className={cx(styles.turnOff)}>
                        Turn off the link
                      </Button>
                    </Popconfirm>
                  ) : null}
                </td>
                <td className={styles.status}>{formatMailDate(postcard.mailDate, locale)}</td>
                <td className={cx(styles.status, statusClass(postcard.status))}>
                  {renderStatus ? (
                    renderStatus(postcard)
                  ) : (
                    <>
                      {customerStatusLabel(postcard.status)}
                      {postcard.status === "sent" && postcard.expectedDeliveryDate && postcard.trackingStatus !== "postcard.delivered" ? (
                        <div className={styles.note}>
                          Expected {formatMailDate(postcard.expectedDeliveryDate, locale)}
                        </div>
                      ) : null}
                      <TrackingTimeline postcard={postcard} locale={locale} />
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
