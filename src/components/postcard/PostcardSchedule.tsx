import type { ReactNode } from "react";
import type { Order } from "@shared/orders";
import { formatRecipient, type Postcard, type PostcardStatus } from "@shared/postcards";
import { ProductImage } from "@/components/ui/ProductImage";
import { cx } from "@/lib/cx";
import { customerStatusLabel, formatMailDate } from "@/lib/postcards";
import styles from "./Postcard.module.css";

/**
 * Every card on an order, with where it is.
 *
 * Shared by the confirmation page and the account's order detail — the same
 * table a buyer sees in both places, so what an email link lands on and what
 * their account shows never disagree. The admin has its own, with the error
 * text and the buttons.
 */
function statusClass(status: PostcardStatus): string {
  if (status === "sent") return styles.statusSent ?? "";
  if (status === "error") return styles.statusError ?? "";
  if (status === "cancelled") return styles.statusCancelled ?? "";
  return "";
}

export function PostcardSchedule({
  order,
  locale,
  renderStatus,
}: {
  order: Pick<Order, "postcards" | "designs">;
  locale: string;
  /** The admin passes its own cell; the storefront gets the plain label. */
  renderStatus?: (postcard: Postcard) => ReactNode;
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
                  <div className={styles.note}>{formatRecipient(postcard.recipient, locale)}</div>
                </td>
                <td className={styles.status}>{formatMailDate(postcard.mailDate, locale)}</td>
                <td className={cx(styles.status, statusClass(postcard.status))}>
                  {renderStatus ? (
                    renderStatus(postcard)
                  ) : (
                    <>
                      {customerStatusLabel(postcard.status)}
                      {postcard.status === "sent" && postcard.expectedDeliveryDate ? (
                        <div className={styles.note}>
                          Expected {formatMailDate(postcard.expectedDeliveryDate, locale)}
                        </div>
                      ) : null}
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
