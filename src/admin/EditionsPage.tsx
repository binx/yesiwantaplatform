import { useState } from "react";
import { Link } from "react-router-dom";
import { App, Button, Card, Empty, Segmented, Skeleton, Table, Tag } from "antd";
import type { EditionStatus } from "@shared/platform";
import { formatMoney } from "@shared/money";
import { formatRecipient } from "@shared/postcards";
import { ProductImage } from "@/components/ui/ProductImage";
import { useAdminEditions, usePostcardErrors, useRetryPostcard, useStoreLocale, type AdminEdition, type AdminPostcard } from "./queries";
import { PageHeader } from "./RequireAdmin";
import { editionShape, formatMailDate } from "@/lib/postcards";

type Filter = EditionStatus | "all";

function editionStatusColor(status: EditionStatus): string {
  return status === "on_sale" ? "green" : status === "closed" ? "default" : "blue";
}

function editionStatusWords(status: EditionStatus): string {
  return status === "on_sale" ? "on sale" : status;
}

/**
 * Every edition on the platform, and above them the cards Lob refused —
 * the one list an operator actually has to work through.
 */
export function EditionsPage() {
  const locale = useStoreLocale();
  const { message } = App.useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const editions = useAdminEditions(filter === "all" ? undefined : filter);
  const errors = usePostcardErrors();
  const retry = useRetryPostcard();

  return (
    <>
      <PageHeader title="Editions" description="Sets of 6 or 12 cards, paid for once. A purchase writes every card of the collector's run with its own date, and the print sweep sends each to Lob as its day comes." />

      {(errors.data?.length ?? 0) > 0 ? (
        <Card title={`${errors.data?.length} card${errors.data?.length === 1 ? "" : "s"} Lob refused`} style={{ marginBottom: "1.25rem" }}>
          <Table<AdminPostcard>
            dataSource={errors.data}
            rowKey="id"
            pagination={false}
            size="small"
            scroll={{ x: "max-content" }}
            columns={[
              { title: "To", dataIndex: ["recipient", "name"], render: (name: string, card) => <Link to={`/admin/editions/${card.editionId}`}>{name}</Link> },
              { title: "Address", dataIndex: "recipient", render: (recipient: AdminPostcard["recipient"]) => formatRecipient(recipient, locale) },
              { title: "Due", dataIndex: "mailDate", render: (date: string) => formatMailDate(date, locale) },
              { title: "Lob said", dataIndex: "lastError", render: (text: string | null) => <span style={{ color: "#b45309" }}>{text}</span> },
              {
                title: "",
                key: "actions",
                render: (_value, card) => (
                  <Button size="small" loading={retry.isPending} onClick={() => retry.mutate(card.id, { onSuccess: () => void message.success("Back on the schedule."), onError: (error: unknown) => void message.error(error instanceof Error ? error.message : "Could not retry.") })}>
                    Retry
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      ) : null}

      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { label: "All", value: "all" },
          { label: "On sale", value: "on_sale" },
          { label: "Draft", value: "draft" },
          { label: "Closed", value: "closed" },
        ]}
        style={{ marginBottom: "1rem" }}
      />

      {editions.isPending ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (editions.data?.editions.length ?? 0) === 0 ? (
        <Empty description="No editions here." />
      ) : (
        <Table<AdminEdition>
          dataSource={editions.data?.editions}
          rowKey="id"
          pagination={false}
          scroll={{ x: "max-content" }}
          columns={[
            {
              title: <span className="sr-only">Cover</span>,
              key: "cover",
              width: 72,
              render: (_value, edition) => {
                const cover = edition.cards[0]?.design.thumbnail;
                return cover ? (
                  <div style={{ width: 56 }}>
                    <ProductImage image={cover} sizes="56px" />
                  </div>
                ) : null;
              },
            },
            { title: "Title", dataIndex: "title", render: (title: string, edition) => <Link to={`/admin/editions/${edition.id}`}>{title}</Link> },
            { title: "Artist", dataIndex: "artist", render: (artist: AdminEdition["artist"]) => (artist ? <Link to={`/admin/artists/${artist.id}`}>{artist.name}</Link> : "—") },
            { title: "Shape", key: "shape", render: (_value, edition) => editionShape(edition.cardCount, edition.cadence) },
            { title: "Price", dataIndex: "priceCents", align: "right", render: (cents: number, edition) => formatMoney(cents, edition.currency, locale) },
            { title: "Status", dataIndex: "status", render: (status: EditionStatus) => <Tag color={editionStatusColor(status)}>{editionStatusWords(status)}</Tag> },
            { title: "Collectors", dataIndex: "collectorCount", align: "right" },
            { title: "Sent", dataIndex: "sentCount", align: "right" },
            { title: "Still to come", dataIndex: "scheduledCount", align: "right" },
          ]}
        />
      )}
    </>
  );
}
