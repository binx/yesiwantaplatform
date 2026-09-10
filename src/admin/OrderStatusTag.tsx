import { Tag } from "antd";
import type { Order } from "@shared/orders";
import { summarisePostcards } from "@shared/orders";
import { formatMoney } from "@shared/money";
import { statusLabel } from "./orderPresentation";

/**
 * An order's status, with the one detail that matters beside it: how many
 * cards are still to go, or how much has come back.
 *
 * A returned card is a second tag rather than a replacement for the first.
 * Its own status is still `sent` — USPS carried it, then brought it back —
 * so "3 of 3 sent" stays true and the return is the news next to it. Without
 * this the list's Returned filter would show rows with nothing to see.
 */
export function OrderStatusTag({ order, locale }: { order: Order; locale: string }) {
  const counts = summarisePostcards(order);

  return (
    <>
      <StatusTag order={order} locale={locale} />
      {counts.returned > 0 ? <Tag color="volcano">{counts.returned} returned</Tag> : null}
    </>
  );
}

function StatusTag({ order, locale }: { order: Order; locale: string }) {
  const counts = summarisePostcards(order);

  if (order.status === "refunded" || order.refundedCents > 0) {
    const partial = order.refundedCents < order.totalCents;
    return (
      <Tag color={partial ? "gold" : "default"}>
        {partial
          ? `${formatMoney(order.refundedCents, order.currency, locale)} refunded`
          : statusLabel("refunded")}
      </Tag>
    );
  }

  if (order.status === "paid") {
    if (counts.error > 0) return <Tag color="volcano">{counts.error} failed</Tag>;
    return (
      <Tag color="blue">
        {counts.sent} of {counts.sent + counts.scheduled} sent
      </Tag>
    );
  }

  const color =
    order.status === "completed" ? "green" : order.status === "cancelled" ? "default" : "orange";

  return <Tag color={color}>{statusLabel(order.status)}</Tag>;
}
