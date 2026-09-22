import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { App, Button, Card, Empty, Segmented, Skeleton, Statistic, Table, Tag } from "antd";
import type { PayoutStatus } from "@shared/platform";
import { formatMoney } from "@shared/money";
import { useAdminPayouts, useRetryPayout, useRunPayouts, useSettings, useStoreLocale, type AdminPayout } from "./queries";
import { PageHeader } from "./RequireAdmin";
import { formatDay } from "@/lib/postcards";

type Filter = PayoutStatus | "all";

/** The ledger: what every sent card earned its artist, and whether Stripe has moved it. */
export function PayoutsPage() {
  const locale = useStoreLocale();
  const settings = useSettings();
  const { message } = App.useApp();
  const [params] = useSearchParams();
  const [filter, setFilter] = useState<Filter>((params.get("status") as Filter | null) ?? "all");
  const payouts = useAdminPayouts(filter === "all" ? undefined : filter);
  const retry = useRetryPayout();
  const run = useRunPayouts();
  const currency = settings.data?.currency ?? "USD";
  const money = (cents: number, c = currency) => formatMoney(cents, c, locale);


  const totals = payouts.data?.totals ?? {};

  return (
    <>
      <PageHeader
        title="Payouts"
        description="One row per sent card. Pending rows are transferred hourly to artists whose Stripe account is ready; failed rows say why, in Stripe's words."
        actions={
          <Button loading={run.isPending} onClick={() => run.mutate(undefined, { onSuccess: (result) => void message.info(result.skipped ?? `${result.paid} paid, ${result.deferred} deferred, ${result.failed} failed.`), onError: (error: unknown) => void message.error(error instanceof Error ? error.message : "Could not run payouts.") })}>
            Run payouts now
          </Button>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <Card>
          <Statistic title="Owed" value={money(totals.pending ?? 0)} />
        </Card>
        <Card>
          <Statistic title="Paid out" value={money(totals.paid ?? 0)} />
        </Card>
        <Card>
          <Statistic title="Failed" value={money(totals.failed ?? 0)} />
        </Card>
      </div>

      <Segmented<Filter> value={filter} onChange={setFilter} options={[{ label: "All", value: "all" }, { label: "Pending", value: "pending" }, { label: "Paid", value: "paid" }, { label: "Failed", value: "failed" }]} style={{ marginBottom: "1rem" }} />

      {payouts.isPending ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (payouts.data?.payouts.length ?? 0) === 0 ? (
        <Empty description="No payouts here." />
      ) : (
        <Table<AdminPayout>
          dataSource={payouts.data?.payouts}
          rowKey="id"
          pagination={false}
          scroll={{ x: "max-content" }}
          columns={[
            { title: "Earned", dataIndex: "createdAt", render: (value: number) => formatDay(value, locale) },
            { title: "Artist", dataIndex: "artist", render: (artist: AdminPayout["artist"]) => (artist ? <Link to={`/admin/artists/${artist.id}`}>{artist.name}</Link> : "—") },
            { title: "Card", dataIndex: "postcardId", render: (id: string, payout) => <Link to={`/admin/mailings/${payout.mailingId}`}>{id.slice(0, 8)}</Link> },
            { title: "Gross", dataIndex: "grossCents", align: "right", render: (cents: number, p) => money(cents, p.currency) },
            { title: "Print", dataIndex: "printCostCents", align: "right", render: (cents: number, p) => money(cents, p.currency) },
            { title: "Fee", dataIndex: "platformFeeCents", align: "right", render: (cents: number, p) => money(cents, p.currency) },
            { title: "To artist", dataIndex: "amountCents", align: "right", render: (cents: number, p) => <strong>{money(cents, p.currency)}</strong> },
            {
              title: "Status",
              dataIndex: "status",
              render: (status: PayoutStatus, p) => (
                <div style={{ display: "grid", gap: "0.25rem" }}>
                  <Tag color={status === "paid" ? "green" : status === "failed" ? "red" : "blue"}>{status}</Tag>
                  {p.stripeTransferId ? <span style={{ color: "#71717a" }}>{p.stripeTransferId}</span> : null}
                  {p.lastError ? <span style={{ color: "#b45309" }}>{p.lastError}</span> : null}
                  {status === "pending" && p.artist && !p.artist.payoutsEnabled ? <span style={{ color: "#71717a" }}>waiting for the artist's Stripe onboarding</span> : null}
                </div>
              ),
            },
            {
              title: "",
              key: "actions",
              render: (_value, p) =>
                p.status === "failed" ? (
                  <Button size="small" loading={retry.isPending} onClick={() => retry.mutate(p.id, { onSuccess: () => void message.success("Queued for the next payout run."), onError: (error: unknown) => void message.error(error instanceof Error ? error.message : "Could not retry.") })}>
                    Retry
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
    </>
  );
}
