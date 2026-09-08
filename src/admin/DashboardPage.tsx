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

      <Unpublished live={products.data?.filter((product) => product.needsPublish) ?? []} />

      <Tax
        enabled={settings.data?.taxEnabled ?? false}
        stale={products.data?.filter((product) => product.needsTaxRepublish) ?? []}
      />

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

interface UnpublishedProps {
  /** On the storefront, with a variant that has no Stripe Price. */
  live: { id: string; name: string; slug: string }[];
}

/**
 * Live but unsellable, said out loud on the first screen.
 *
 * This one only ever fails in front of a customer: the product looks normal
 * on the storefront, goes into a cart, and checkout refuses the whole order.
 * The buyer is told the product is unavailable — they can do nothing with the
 * reason, and naming Stripe to them means naming a company they have no
 * relationship with — so the reason is said here instead, where someone can
 * act on it.
 */
function Unpublished({ live }: UnpublishedProps) {
  if (live.length === 0) return null;

  return (
    <Alert
      className={cx(styles.wiring)}
      type="error"
      showIcon
      title={`${live.length} live product${live.length === 1 ? " is" : "s are"} not published to Stripe`}
      description={
        <>
          {live.length === 1 ? "It is" : "They are"} on the storefront and can be added to a
          cart, but checkout refuses any order containing {live.length === 1 ? "it" : "them"}.
          Publish from the product editor, or take {live.length === 1 ? "it" : "them"} off the
          storefront until you do.
          <span className={cx(styles.staleList)}>
            {live.map((product) => (
              <Link key={product.id} to={`/admin/products/${product.slug}`}>
                {product.name}
              </Link>
            ))}
          </span>
        </>
      }
    />
  );
}

interface TaxProps {
  enabled: boolean;
  /** Published under tax settings the store no longer uses. */
  stale: { id: string; name: string; slug: string }[];
}

/**
 * Tax, said out loud on the first screen.
 *
 * Under-collecting is silent: every order goes through, the buyer pays, and
 * the difference is owed by the merchant with nothing anywhere to say so. The
 * same is true one step in — a store that changed how it quotes prices has
 * every already-published Stripe Price still carrying the old behaviour,
 * because Stripe will not let a Price be edited. Neither state announces
 * itself, so both are announced here.
 */
function Tax({ enabled, stale }: TaxProps) {
  if (!enabled) {
    return (
      <Alert
        className={cx(styles.wiring)}
        type="info"
        showIcon
        title="This store is not collecting tax"
        description={
          <>
            Every order is charged with no tax added. If you are obliged to collect anywhere,
            activate Stripe Tax and record your registrations in the Stripe dashboard first,
            then turn it on in <Link to="/admin/settings">Settings</Link>.
          </>
        }
      />
    );
  }

  if (stale.length === 0) return null;

  return (
    <Alert
      className={cx(styles.wiring)}
      type="warning"
      showIcon
      title={`${stale.length} product${stale.length === 1 ? "" : "s"} ${
        stale.length === 1 ? "was" : "were"
      } published before these tax settings`}
      description={
        <>
          Stripe will not let a Price change its tax code or behaviour, so these still carry
          the old ones until each is published again. Nothing republishes on its own —
          writing to a live Stripe account is always something you ask for.
          <span className={cx(styles.staleList)}>
            {stale.map((product) => (
              <Link key={product.id} to={`/admin/products/${product.slug}`}>
                {product.name}
              </Link>
            ))}
          </span>
        </>
      }
    />
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
