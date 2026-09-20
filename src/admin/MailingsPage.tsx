import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { App, Button, Card, Empty, Segmented, Skeleton, Table, Tag } from "antd";
import { useAdminMailings, usePostcardErrors, useRetryPostcard, useStoreLocale, type AdminMailing, type AdminPostcard } from "./queries";
import { PageHeader } from "./RequireAdmin";
import { formatMailDate } from "@/lib/postcards";
import { formatRecipient } from "@shared/postcards";

type Filter = "all" | "queued" | "mailed";

/**
 * Every mailing on the platform, and above them the cards Lob refused —
 * the one list an operator actually has to work through.
 */
export function MailingsPage() {
  const locale = useStoreLocale();
  const { message } = App.useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const mailings = useAdminMailings(filter === "all" ? undefined : filter);
  const errors = usePostcardErrors();
  const retry = useRetryPostcard();

  useEffect(() => {
    document.title = "Mailings · Admin";
  }, []);

  return (
    <>
      <PageHeader title="Mailings" description="One per artist per month. On its date every active subscriber is written a card, and the print sweep sends each to Lob." />

      {(errors.data?.length ?? 0) > 0 ? (
        <Card title={`${errors.data?.length} card${errors.data?.length === 1 ? "" : "s"} Lob refused`} style={{ marginBottom: "1.25rem" }}>
          <Table<AdminPostcard>
            dataSource={errors.data}
            rowKey="id"
            pagination={false}
            size="small"
            scroll={{ x: "max-content" }}
            columns={[
              { title: "To", dataIndex: ["recipient", "name"], render: (name: string, card) => <Link to={`/admin/mailings/${card.mailingId}`}>{name}</Link> },
              { title: "Address", dataIndex: "recipient", render: (recipient: AdminPostcard["recipient"]) => formatRecipient(recipient, locale) },
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

      <Segmented<Filter> value={filter} onChange={setFilter} options={[{ label: "All", value: "all" }, { label: "Queued", value: "queued" }, { label: "Mailed", value: "mailed" }]} style={{ marginBottom: "1rem" }} />

      {mailings.isPending ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (mailings.data?.mailings.length ?? 0) === 0 ? (
        <Empty description="No mailings." />
      ) : (
        <Table<AdminMailing>
          dataSource={mailings.data?.mailings}
          rowKey="id"
          pagination={false}
          scroll={{ x: "max-content" }}
          columns={[
            { title: "Date", dataIndex: "mailDate", render: (date: string, mailing) => <Link to={`/admin/mailings/${mailing.id}`}>{formatMailDate(date, locale)}</Link> },
            { title: "Artist", dataIndex: "artist", render: (artist: AdminMailing["artist"]) => (artist ? <Link to={`/admin/artists/${artist.id}`}>{artist.name}</Link> : "—") },
            { title: "Title", dataIndex: "title", render: (title: string | null) => title ?? "—" },
            { title: "Status", dataIndex: "status", render: (status: string) => <Tag color={status === "mailed" ? "green" : status === "queued" ? "blue" : "default"}>{status}</Tag> },
            { title: "Subscribers", dataIndex: "subscriberCount", align: "right" },
            { title: "Sent", dataIndex: ["postcards", "sent"], align: "right" },
            { title: "Waiting", dataIndex: ["postcards", "scheduled"], align: "right" },
            { title: "Failed", dataIndex: ["postcards", "error"], align: "right", render: (n: number) => (n > 0 ? <Tag color="red">{n}</Tag> : n) },
          ]}
        />
      )}
    </>
  );
}
