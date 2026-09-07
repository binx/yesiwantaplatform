import { Tag, Tooltip } from "antd";
import type { Order } from "@shared/orders";
import { STATUS_LABELS } from "./orderPresentation";

/**
 * A status badge that cannot throw.
 *
 * `oversold` rides along because it is the one flag an owner must not miss:
 * payment succeeded after stock ran out, so the money is taken and the order
 * cannot be fulfilled as placed.
 */
export function OrderStatusTag({ order }: { order: Pick<Order, "status" | "oversold"> }) {
  const entry = STATUS_LABELS[order.status];

  return (
    <>
      <Tag color={entry?.color ?? "default"}>{entry?.label ?? order.status ?? "Unknown"}</Tag>
      {order.oversold ? (
        <Tooltip title="Paid, but stock had run out. Refund it or restock before fulfilling.">
          <Tag color="red">Oversold</Tag>
        </Tooltip>
      ) : null}
    </>
  );
}
