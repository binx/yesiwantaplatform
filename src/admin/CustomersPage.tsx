import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card, Empty, Skeleton, Table, Tag } from "antd";

/**
 * A table that may overflow sideways on a phone, in a region a keyboard can
 * reach: antd's own scroll container is not focusable, and a table with no
 * links in it has nothing else to tab to.
 */
function Scrollable({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={label}
      style={{ overflowX: "auto" }}
    >
      {children}
    </div>
  );
}
import type { Order, Subscription } from "@shared/platform";
import { formatMoney } from "@shared/money";
import {
  useAdminCustomers,
  useAdminOrders,
  useAdminSubscriptions,
  useStoreLocale,
  type AdminCustomer,
} from "./queries";
import { PageHeader } from "./RequireAdmin";
import { formatDay, subscriptionStatusLabel } from "@/lib/postcards";

/** Everyone with an account, every subscription, every invoice. */
export function CustomersPage() {
  const locale = useStoreLocale();
  const customers = useAdminCustomers();
  const subscriptions = useAdminSubscriptions();
  const orders = useAdminOrders();


  return (
    <>
      <PageHeader
        title="People"
        description="Accounts, subscriptions and the invoices Stripe has paid. Addresses live on the subscription."
      />

      <Card title="Accounts" style={{ marginBottom: "1.25rem" }}>
        {customers.isPending ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : (customers.data?.length ?? 0) === 0 ? (
          <Empty
            description="Nobody yet."
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <Scrollable label="Accounts">
            <Table<AdminCustomer>
              dataSource={customers.data}
              rowKey="id"
              pagination={{ pageSize: 25 }}
              size="small"
              columns={[
                { title: "Email", dataIndex: "email" },
                {
                  title: "Name",
                  dataIndex: "name",
                  render: (name: string | null) => name ?? "—",
                },
                {
                  title: "Verified",
                  dataIndex: "emailVerified",
                  render: (v: boolean) =>
                    v ? <Tag color="green">yes</Tag> : <Tag>no</Tag>,
                },
                {
                  title: "Artist page",
                  dataIndex: "artistSlug",
                  render: (slug: string | null) => (slug ? `/artist/${slug}` : "—"),
                },
                {
                  title: "Active subscriptions",
                  dataIndex: "activeSubscriptions",
                  align: "right",
                },
                {
                  title: "Since",
                  dataIndex: "createdAt",
                  render: (value: number) => formatDay(value, locale),
                },
              ]}
            />
          </Scrollable>
        )}
      </Card>

      <Card title="Subscriptions" style={{ marginBottom: "1.25rem" }}>
        {subscriptions.isPending ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : (subscriptions.data?.subscriptions.length ?? 0) === 0 ? (
          <Empty description="None yet." image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Scrollable label="Subscriptions">
            <Table<Subscription>
              dataSource={subscriptions.data?.subscriptions}
              rowKey="id"
              pagination={{ pageSize: 25 }}
              size="small"
              columns={[
                { title: "Subscriber", dataIndex: ["address", "name"] },
                {
                  title: "Artist",
                  dataIndex: "artist",
                  render: (artist: Subscription["artist"]) => (
                    <Link to={`/admin/artists/${artist.id}`}>
                      {artist.name}
                    </Link>
                  ),
                },
                {
                  title: "Status",
                  dataIndex: "status",
                  render: (_s: string, sub) => (
                    <Tag>
                      {subscriptionStatusLabel(
                        sub.status,
                        sub.cancelAtPeriodEnd,
                      )}
                    </Tag>
                  ),
                },
                {
                  title: "Pays",
                  dataIndex: "priceCents",
                  align: "right",
                  render: (cents: number, sub) =>
                    formatMoney(cents, sub.currency, locale),
                },
                {
                  title: "Renews",
                  dataIndex: "currentPeriodEnd",
                  render: (value: number | null) =>
                    value ? formatDay(value, locale) : "—",
                },
                {
                  title: "Since",
                  dataIndex: "createdAt",
                  render: (value: number) => formatDay(value, locale),
                },
              ]}
            />
          </Scrollable>
        )}
      </Card>

      <Card title="Invoices">
        {orders.isPending ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : (orders.data?.orders.length ?? 0) === 0 ? (
          <Empty
            description="Nothing paid yet."
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <Scrollable label="Invoices">
            <Table<Order>
              dataSource={orders.data?.orders}
              rowKey="id"
              pagination={{ pageSize: 25 }}
              size="small"
              columns={[
                { title: "Reference", dataIndex: "reference" },
                {
                  title: "Artist",
                  dataIndex: "artist",
                  render: (artist: Order["artist"]) => (
                    <Link to={`/admin/artists/${artist.id}`}>
                      {artist.name}
                    </Link>
                  ),
                },
                {
                  title: "Paid",
                  dataIndex: "createdAt",
                  render: (value: number) => formatDay(value, locale),
                },
                {
                  title: "Amount",
                  dataIndex: "amountCents",
                  align: "right",
                  render: (cents: number, o) =>
                    formatMoney(cents, o.currency, locale),
                },
                {
                  title: "Refunded",
                  dataIndex: "refundedCents",
                  align: "right",
                  render: (cents: number, o) =>
                    cents > 0 ? formatMoney(cents, o.currency, locale) : "—",
                },
                {
                  title: "Status",
                  dataIndex: "status",
                  render: (status: string) => (
                    <Tag color={status === "paid" ? "green" : "default"}>
                      {status}
                    </Tag>
                  ),
                },
              ]}
            />
          </Scrollable>
        )}
      </Card>
    </>
  );
}
