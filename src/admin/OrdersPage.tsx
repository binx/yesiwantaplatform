import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Empty, Segmented, Skeleton, Table } from "antd";
import type { Order, OrderStatus } from "@shared/orders";
import { formatMoney } from "@shared/money";
import { cx } from "@/lib/cx";
import { ORDER_PAGE_SIZE, useOrders,
  useStoreLocale,
} from "./queries";
import { PageHeader } from "./RequireAdmin";
import { OrderStatusTag } from "./OrderStatusTag";
import { ORDER_STATUSES, formatOrderDate, statusLabel } from "./orderPresentation";
import styles from "./OrdersPage.module.css";

/**
 * Orders.
 *
 * Paging is by offset and moves in the direction it says it does — v1's
 * cursors were inverted, so "next" went back. The offset is reset whenever the
 * filter changes, because page 3 of "all" is not page 3 of "shipped".
 */
export function OrdersPage() {
  const locale = useStoreLocale();
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const [offset, setOffset] = useState(0);

  const orders = useOrders(status, offset);

  useEffect(() => {
    document.title = "Orders · Admin";
  }, []);

  const total = orders.data?.total ?? 0;
  const rows = orders.data?.orders ?? [];

  const page = Math.floor(offset / ORDER_PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / ORDER_PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Orders"
        description="An order is recorded when Stripe's webhook confirms payment. Each postcard on it goes to Lob on its own day."
        actions={
          /*
           * A plain link, not a fetch: the route is a cookie-authenticated GET,
           * and verifyCsrf skips safe methods, so there is no token to attach
           * and no blob to build. The browser saves the stream as it arrives.
           */
          <a href={`/api/admin/orders.csv${status === "all" ? "" : `?status=${status}`}`}>
            <Button>Download CSV</Button>
          </a>
        }
      />

      <Segmented<OrderStatus | "all">
        className={cx(styles.filter)}
        value={status}
        onChange={(next) => {
          setStatus(next);
          setOffset(0);
        }}
        options={[
          { label: "All", value: "all" },
          ...ORDER_STATUSES.map((value) => ({ label: statusLabel(value), value })),
        ]}
      />

      {orders.isPending ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : rows.length === 0 ? (
        <Empty
          description={
            status === "all" ? "No orders yet." : `No ${statusLabel(status).toLowerCase()} orders.`
          }
        />
      ) : (
        <>
          <Table<Order>
            dataSource={rows}
            rowKey="id"
            pagination={false}
            // The table scrolls inside itself on a narrow screen instead of
            // pushing the page sideways, which is what v1's tables did.
            scroll={{ x: "max-content" }}
            columns={[
              {
                title: "Reference",
                dataIndex: "reference",
                render: (reference: string, order) => (
                  <Link to={`/admin/orders/${order.id}`}>{reference}</Link>
                ),
              },
              { title: "Email", dataIndex: "email" },
              {
                title: "Status",
                dataIndex: "status",
                render: (_value, order) => <OrderStatusTag order={order} locale={locale} />,
              },
              { title: "Postcards", dataIndex: "postcardCount", align: "right" },
              {
                title: "Total",
                dataIndex: "totalCents",
                align: "right",
                render: (cents: number, order) => formatMoney(cents, order.currency, locale),
              },
              {
                title: "Placed",
                dataIndex: "createdAt",
                render: (value: number) => formatOrderDate(value, false, locale),
              },
            ]}
          />

          <div className={cx(styles.pager)}>
            <Button
              disabled={offset === 0 || orders.isFetching}
              onClick={() => setOffset(Math.max(0, offset - ORDER_PAGE_SIZE))}
            >
              ← Newer
            </Button>
            <span className={cx(styles.pageCount)}>
              Page {page} of {pages} — {total} order{total === 1 ? "" : "s"}
            </span>
            <Button
              disabled={offset + ORDER_PAGE_SIZE >= total || orders.isFetching}
              onClick={() => setOffset(offset + ORDER_PAGE_SIZE)}
            >
              Older →
            </Button>
          </div>
        </>
      )}
    </>
  );
}
