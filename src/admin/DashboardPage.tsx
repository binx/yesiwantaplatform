import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Card, Empty, Skeleton, Statistic, Table, Tag } from "antd";
import type { Order } from "@shared/orders";
import { formatMoney } from "@shared/money";
import { useEnvironment, useOrders, useProducts, useSettings } from "./queries";
import { PageHeader } from "./RequireAdmin";
import { OrderStatusTag } from "./OrderStatusTag";
import { formatOrderDate } from "./orderPresentation";
import { cx } from "@/lib/cx";
import styles from "./DashboardPage.module.css";

/**
 * Overview.
 *
 * The point of the wiring panel is that a store can be *almost* working — a
 * catalogue, no webhook secret — and the failure mode is silent: Stripe takes
 * the money and no order is ever recorded. That is worth saying on the first
 * screen rather than leaving it to be discovered by a customer.
 */
export function DashboardPage() {
  const settings = useSettings();
  const products = useProducts();
  const orders = useOrders("all", 0);
  const environment = useEnvironment();

  useEffect(() => {
    document.title = "Overview · Beluga";
  }, []);

  const live = products.data?.filter((product) => product.isLive).length ?? 0;
  const drafts = (products.data?.length ?? 0) - live;

  const paidOrders = orders.data?.orders.filter((order) => order.status !== "pending") ?? [];
  const revenue = paidOrders.reduce((total, order) => total + order.totalCents, 0);
  const currency = settings.data?.currency ?? "USD";

  return (
    <>
      <PageHeader
        title="Overview"
        description={settings.data ? `Managing ${settings.data.name}.` : undefined}
        actions={
          <Link to="/admin/products/new">
            <Button type="primary">New product</Button>
          </Link>
        }
      />

      {environment.data ? <Wiring environment={environment.data} /> : null}

      <div className={cx(styles.stats)}>
        <Card>
          <Statistic title="Live products" value={live} loading={products.isPending} />
          {drafts > 0 ? (
            <p className={cx(styles.statNote)}>
              {drafts} draft{drafts === 1 ? "" : "s"} not on the storefront
            </p>
          ) : null}
        </Card>
        <Card>
          <Statistic title="Orders" value={orders.data?.total ?? 0} loading={orders.isPending} />
        </Card>
        <Card>
          <Statistic
            title="Recent revenue"
            value={formatMoney(revenue, currency)}
            loading={orders.isPending}
          />
          <p className={cx(styles.statNote)}>Across the most recent {paidOrders.length} paid orders</p>
        </Card>
      </div>

      <Card
        className={cx(styles.recent)}
        title="Recent orders"
        extra={<Link to="/admin/orders">All orders</Link>}
      >
        {orders.isPending ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : (orders.data?.orders.length ?? 0) === 0 ? (
          <Empty description="No orders yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table<Order>
            dataSource={orders.data?.orders.slice(0, 5)}
            rowKey="id"
            pagination={false}
            size="middle"
            // Narrow screens scroll the table rather than the page. v1's order
            // tables simply overflowed their container.
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
                render: (_value, order) => <OrderStatusTag order={order} />,
              },
              {
                title: "Total",
                dataIndex: "totalCents",
                align: "right",
                render: (cents: number, order) => formatMoney(cents, order.currency),
              },
              {
                title: "Placed",
                dataIndex: "createdAt",
                render: (value: number) => formatOrderDate(value),
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}

interface WiringProps {
  environment: {
    hasStripeSecret: boolean;
    stripeMode: "test" | "live" | null;
    hasWebhookSecret: boolean;
    hasEmail: boolean;
    database: "sqlite" | "postgres";
  };
}

function Wiring({ environment }: WiringProps) {
  const notices = [];

  if (!environment.hasStripeSecret) {
    notices.push({
      type: "info" as const,
      title: "Stripe is not connected",
      description:
        "The catalogue works, but nothing can be sold. Set STRIPE_SECRET_KEY in .env and restart the API.",
    });
  } else if (!environment.hasWebhookSecret) {
    notices.push({
      type: "warning" as const,
      title: "Stripe is connected, but webhooks are not",
      description:
        "The webhook is the only thing that marks an order paid — the success redirect proves nothing. Without STRIPE_WEBHOOK_SECRET a real payment will succeed at Stripe and no order will be recorded here.",
    });
  }

  if (environment.hasStripeSecret && environment.stripeMode === "live") {
    notices.push({
      type: "warning" as const,
      title: "Live mode",
      description: "Publishing a product creates real Stripe objects and checkouts charge cards.",
    });
  }

  if (!environment.hasEmail) {
    notices.push({
      type: "info" as const,
      title: "No email provider",
      description:
        "Order confirmations are logged instead of sent. Set SMTP_URL and EMAIL_FROM when you are ready.",
    });
  }

  if (notices.length === 0) {
    return (
      <Alert
        className={cx(styles.wiring)}
        type="success"
        showIcon
        title={
          <>
            Everything is wired up{" "}
            <Tag color={environment.stripeMode === "live" ? "red" : "blue"}>
              Stripe {environment.stripeMode}
            </Tag>
            <Tag>{environment.database}</Tag>
          </>
        }
      />
    );
  }

  return (
    <div className={cx(styles.wiring)}>
      {notices.map((notice) => (
        <Alert
          key={notice.title}
          className={cx(styles.notice)}
          type={notice.type}
          showIcon
          title={notice.title}
          description={notice.description}
        />
      ))}
    </div>
  );
}
