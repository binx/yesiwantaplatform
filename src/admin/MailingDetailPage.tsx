import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { App, Button, Card, Descriptions, Empty, Popconfirm, Skeleton, Table, Tag } from "antd";
import { formatRecipient } from "@shared/postcards";
import { ProductImage } from "@/components/ui/ProductImage";
import { useAdminMailing, useCancelPostcard, useRetryPostcard, useStoreLocale, type AdminPostcard } from "./queries";
import { PageHeader } from "./RequireAdmin";
import { adminStatusLabel, formatMailDate, trackingLabel } from "@/lib/postcards";

/**
 * One mailing, card by card.
 *
 * The thing this page exists for is the failed card: Lob's refusal, in Lob's
 * own words, next to a Retry button.
 */
export function MailingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { message } = App.useApp();
  const locale = useStoreLocale();
  const detail = useAdminMailing(id);
  const retry = useRetryPostcard();
  const cancel = useCancelPostcard();

  useEffect(() => {
    document.title = "Mailing · Admin";
  }, []);

  if (detail.isPending) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (detail.isError || !detail.data) {
    return (
      <Empty description="No mailing here.">
        <Link to="/admin/mailings">
          <Button>Back to mailings</Button>
        </Link>
      </Empty>
    );
  }

  const { mailing, artist, postcards } = detail.data;
  const fail = (fallback: string) => (error: unknown) => void message.error(error instanceof Error ? error.message : fallback);

  return (
    <>
      <PageHeader
        title={`${artist?.name ?? "An artist"} · ${formatMailDate(mailing.mailDate, locale)}`}
        description={
          <>
            {mailing.title ? `${mailing.title} · ` : ""}
            <Tag color={mailing.status === "mailed" ? "green" : "blue"}>{mailing.status}</Tag>
          </>
        }
        actions={
          <Link to="/admin/mailings">
            <Button>All mailings</Button>
          </Link>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 16rem) minmax(0, 1fr)", gap: "1.25rem", marginBottom: "1.25rem" }}>
        <Card>
          <ProductImage image={mailing.design.thumbnail} sizes="256px" />
          {mailing.design.back.text ? (
            <p style={{ marginTop: "1rem", whiteSpace: "pre-wrap", fontFamily: `"${mailing.design.back.fontName}", cursive` }}>
              {mailing.design.back.text}
              {mailing.design.back.valediction ? <span style={{ display: "block", textAlign: "right" }}>{mailing.design.back.valediction}</span> : null}
            </p>
          ) : null}
        </Card>
        <Card>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Artist">{artist ? <Link to={`/admin/artists/${artist.id}`}>{artist.name}</Link> : "—"}</Descriptions.Item>
            <Descriptions.Item label="Goes out">{formatMailDate(mailing.mailDate, locale)}</Descriptions.Item>
            <Descriptions.Item label="Subscribers when it went">{mailing.status === "mailed" ? mailing.subscriberCount : "not yet"}</Descriptions.Item>
            <Descriptions.Item label="Cards">
              {mailing.postcards.sent} sent · {mailing.postcards.scheduled} waiting · {mailing.postcards.error} failed · {mailing.postcards.cancelled} cancelled
            </Descriptions.Item>
            <Descriptions.Item label="In the gallery">{mailing.inGallery ? "yes" : "no"}</Descriptions.Item>
          </Descriptions>
        </Card>
      </div>

      <Card title="Postcards">
        {postcards.length === 0 ? (
          <Empty description={mailing.status === "queued" ? "Cards are written on the mailing day." : "No cards."} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table<AdminPostcard>
            dataSource={postcards}
            rowKey="id"
            pagination={false}
            size="small"
            scroll={{ x: "max-content" }}
            columns={[
              { title: "To", dataIndex: ["recipient", "name"] },
              { title: "Address", dataIndex: "recipient", render: (recipient: AdminPostcard["recipient"]) => formatRecipient(recipient, locale) },
              {
                title: "Status",
                dataIndex: "status",
                render: (_status: string, card) => (
                  <div style={{ display: "grid", gap: "0.25rem" }}>
                    <span>{adminStatusLabel(card.status)}</span>
                    {card.lobUrl ? (
                      <a href={card.lobUrl} target="_blank" rel="noreferrer">
                        Proof
                      </a>
                    ) : null}
                    {card.expectedDeliveryDate ? <span style={{ color: "#71717a" }}>expected {card.expectedDeliveryDate}</span> : null}
                    {card.lastError ? <span style={{ color: "#b45309" }}>{card.lastError}</span> : null}
                    {card.tracking.length > 0 ? <span style={{ color: "#71717a" }}>{card.tracking.map((event) => trackingLabel(event.type)).join(" → ")}</span> : null}
                  </div>
                ),
              },
              { title: "Attempts", dataIndex: "attempts", align: "right" },
              {
                title: "",
                key: "actions",
                render: (_value, card) => (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    {card.status === "error" || card.status === "cancelled" ? (
                      <Button size="small" loading={retry.isPending} onClick={() => retry.mutate(card.id, { onSuccess: () => void message.success("Back on the schedule."), onError: fail("Could not retry.") })}>
                        Retry
                      </Button>
                    ) : null}
                    {card.status === "scheduled" || card.status === "error" ? (
                      <Popconfirm title="Withdraw this postcard?" description="It will not be printed." onConfirm={() => cancel.mutate(card.id, { onSuccess: () => void message.success("Withdrawn."), onError: fail("Could not withdraw it.") })}>
                        <Button size="small" danger loading={cancel.isPending}>
                          Withdraw
                        </Button>
                      </Popconfirm>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}
