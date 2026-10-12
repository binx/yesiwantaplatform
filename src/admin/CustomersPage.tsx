import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card, Empty, Skeleton, Table, Tag } from "antd";
import type { PurchaseStatus } from "@shared/platform";
import { formatMoney } from "@shared/money";
import {
  useAdminCustomers,
  useAdminPurchases,
  useStoreLocale,
  type AdminCustomer,
  type AdminPurchase,
} from "./queries";
import { PageHeader } from "./RequireAdmin";
import { editionShape, formatDay, purchaseStatusLabel } from "@/lib/postcards";

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

/** Everyone with an account, and every edition they bought. */
export function CustomersPage() {
  const locale = useStoreLocale();
  const customers = useAdminCustomers();
  const purchases = useAdminPurchases();

  return (
    <>
      <PageHeader
        title="People"
        description="Accounts, and the editions they paid for. Addresses live on the purchase."
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
                  title: "Purchases",
                  dataIndex: "purchases",
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

      <Card title="Purchases">
        {purchases.isPending ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : (purchases.data?.purchases.length ?? 0) === 0 ? (
          <Empty
            description="Nothing bought yet."
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <Scrollable label="Purchases">
            <Table<AdminPurchase>
              dataSource={purchases.data?.purchases}
              rowKey="id"
              pagination={{ pageSize: 25 }}
              size="small"
              columns={[
                { title: "Collector", dataIndex: ["address", "name"] },
                {
                  title: "Edition",
                  dataIndex: "edition",
                  render: (edition: AdminPurchase["edition"], p) => (
                    <>
                      <Link to={`/admin/editions/${edition.id}`}>
                        {edition.title}
                      </Link>
                      <span style={{ display: "block", color: "#71717a" }}>
                        {editionShape(p.cardCount, p.cadence)}
                      </span>
                    </>
                  ),
                },
                {
                  title: "Artist",
                  dataIndex: "artist",
                  render: (artist: AdminPurchase["artist"]) => (
                    <Link to={`/admin/artists/${artist.id}`}>
                      {artist.name}
                    </Link>
                  ),
                },
                {
                  title: "Progress",
                  key: "progress",
                  render: (_value, p) => `${p.sentCount} of ${p.cardCount} sent`,
                },
                {
                  title: "Paid",
                  dataIndex: "priceCents",
                  align: "right",
                  render: (cents: number, p) =>
                    formatMoney(cents, p.currency, locale),
                },
                {
                  title: "Refunded",
                  dataIndex: "refundedCents",
                  align: "right",
                  render: (cents: number, p) =>
                    cents > 0 ? formatMoney(cents, p.currency, locale) : "—",
                },
                {
                  title: "Status",
                  dataIndex: "status",
                  render: (status: PurchaseStatus) => (
                    <Tag
                      color={
                        status === "paid"
                          ? "green"
                          : status === "refunded"
                            ? "default"
                            : "gold"
                      }
                    >
                      {purchaseStatusLabel(status)}
                    </Tag>
                  ),
                },
                {
                  title: "Bought",
                  dataIndex: "createdAt",
                  render: (value: number) => formatDay(value, locale),
                },
              ]}
            />
          </Scrollable>
        )}
      </Card>
    </>
  );
}
