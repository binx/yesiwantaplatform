import { Tag, Tooltip } from "antd";
import type { Order } from "@shared/orders";
import { formatMoney } from "@shared/money";
import { STATUS_LABELS } from "./orderPresentation";

/**
 * A status badge that cannot throw.
 *
 * `oversold` rides along because it is the one flag an owner must not miss:
 * payment succeeded after stock ran out, so the money is taken and the order
 * cannot be fulfilled as placed.
 *
 * A partial refund gets its own tag because the status does not move: an order
 * refunded for one damaged item of three is still `shipped`, and without this
 * the only trace would be a total that no longer matches what was charged.
 */
export function OrderStatusTag({
  order,
}: {
  order: Pick<Order, "status" | "oversold" | "refundedCents" | "totalCents" | "currency">;
}) {
  const entry = STATUS_LABELS[order.status];
  const partiallyRefunded = order.refundedCents > 0 && order.refundedCents < order.totalCents;

  return (
    <>
      <Tag color={entry?.color ?? "default"}>{entry?.label ?? order.status ?? "Unknown"}</Tag>
      {order.oversold ? (
        <Tooltip title="Paid, but stock had run out. Refund it or restock before fulfilling.">
          <Tag color="red">Oversold</Tag>
        </Tooltip>
      ) : null}
      {partiallyRefunded ? (
        <Tag color="orange">
          Partially refunded — {formatMoney(order.refundedCents, order.currency)} of{" "}
          {formatMoney(order.totalCents, order.currency)}
        </Tag>
      ) : null}
    </>
  );
}
