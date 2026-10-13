import { Link, useParams } from "react-router-dom";
import { App, Button, Card, Descriptions, Empty, Popconfirm, Skeleton, Table, Tag } from "antd";
import type { EditionStatus, PurchaseStatus } from "@shared/platform";
import { formatMoney } from "@shared/money";
import { formatRecipient } from "@shared/postcards";
import { ProductImage } from "@/components/ui/ProductImage";
import { useAdminEdition, useCancelPostcard, useRetryPostcard, useStoreLocale, type AdminPostcard, type AdminPurchase } from "./queries";
import { PageHeader } from "./RequireAdmin";
import { ReviewDecision } from "./ReviewDecision";
import { adminStatusLabel, editionShape, formatDay, formatMailDate, purchaseStatusLabel, trackingLabel } from "@/lib/postcards";

const editionStatusColor = (status: EditionStatus): string => (status === "on_sale" ? "green" : status === "closed" ? "default" : status === "in_review" ? "purple" : "blue");
const editionStatusWords = (status: EditionStatus): string => (status === "on_sale" ? "on sale" : status === "in_review" ? "in review" : status);
const purchaseStatusColor = (status: PurchaseStatus): string => (status === "paid" ? "green" : status === "refunded" ? "default" : "gold");

/**
 * One edition: its cards in order, who collected it, and every card of
 * every run.
 *
 * The thing this page exists for is the failed card: Lob's refusal, in Lob's
 * own words, next to a Retry button.
 */
export function EditionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { message } = App.useApp();
  const locale = useStoreLocale();
  const detail = useAdminEdition(id);
  const retry = useRetryPostcard();
  const cancel = useCancelPostcard();

  if (detail.isPending) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (detail.isError || !detail.data) {
    return (
      <Empty description="No edition here.">
        <Link to="/admin/editions">
          <Button>Back to editions</Button>
        </Link>
      </Empty>
    );
  }

  const { edition, artist, purchases, postcards } = detail.data;
  const fail = (fallback: string) => (error: unknown) => void message.error(error instanceof Error ? error.message : fallback);
  const money = (cents: number, currency = edition.currency) => formatMoney(cents, currency, locale);
  const cardTitle = new Map(edition.cards.map((card) => [card.position, card.title]));

  return (
    <>
      <PageHeader
        title={edition.title}
        description={
          <>
            {artist ? `${artist.name} · ` : ""}
            {editionShape(edition.cardCount)} · <Tag color={editionStatusColor(edition.status)}>{editionStatusWords(edition.status)}</Tag>
          </>
        }
        actions={
          <Link to="/admin/editions">
            <Button>All editions</Button>
          </Link>
        }
      />

      {edition.status === "in_review" ? (
        <Card title="Review" style={{ marginBottom: "1.25rem" }}>
          <ReviewDecision kind="edition" id={edition.id} name={edition.title} />
        </Card>
      ) : edition.reviewNote ? (
        <Card title="Review" style={{ marginBottom: "1.25rem" }}>
          <p style={{ marginTop: 0 }}>Declined, with this note to the artist:</p>
          <blockquote style={{ margin: 0, paddingLeft: "1rem", borderLeft: "3px solid #e4e4e7", whiteSpace: "pre-wrap" }}>{edition.reviewNote}</blockquote>
        </Card>
      ) : null}

      <Card style={{ marginBottom: "1.25rem" }}>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="Artist">{artist ? <Link to={`/admin/artists/${artist.id}`}>{artist.name}</Link> : "—"}</Descriptions.Item>
          <Descriptions.Item label="Shape">{editionShape(edition.cardCount)}</Descriptions.Item>
          <Descriptions.Item label="Price">
            {money(edition.priceCents)} for the set · {money(Math.floor(edition.priceCents / edition.cardCount))} a card
          </Descriptions.Item>
          <Descriptions.Item label="Status">
            <Tag color={editionStatusColor(edition.status)}>{editionStatusWords(edition.status)}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Collectors">{edition.collectorCount}</Descriptions.Item>
          <Descriptions.Item label="Cards">
            {edition.sentCount} sent · {edition.scheduledCount} still to come
          </Descriptions.Item>
          <Descriptions.Item label="In the gallery">{edition.inGallery ? "yes" : "no"}</Descriptions.Item>
          <Descriptions.Item label="Since">{formatDay(edition.createdAt, locale)}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title={`The cards (${edition.cards.length} of ${edition.cardCount})`} style={{ marginBottom: "1.25rem" }}>
        {edition.cards.length === 0 ? (
          <Empty description="No cards yet." image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(12rem, 1fr))", gap: "1.25rem" }}>
            {[...edition.cards]
              .sort((a, b) => a.position - b.position)
              .map((card) => (
                <li key={card.id}>
                  <ProductImage image={card.design.thumbnail} sizes="192px" />
                  <p style={{ margin: "0.5rem 0 0" }}>
                    <strong>{card.position}.</strong> {card.title ?? <span style={{ color: "#71717a" }}>untitled</span>}
                  </p>
                  {card.design.back.text ? (
                    <p style={{ marginTop: "0.5rem", whiteSpace: "pre-wrap", fontFamily: `"${card.design.back.fontName}", cursive` }}>
                      {card.design.back.text}
                      {card.design.back.valediction ? <span style={{ display: "block", textAlign: "right" }}>{card.design.back.valediction}</span> : null}
                    </p>
                  ) : null}
                </li>
              ))}
          </ol>
        )}
      </Card>

      <Card title="Purchases" style={{ marginBottom: "1.25rem" }}>
        {purchases.length === 0 ? (
          <Empty description="Nobody has collected it yet." image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table<AdminPurchase>
            dataSource={purchases}
            rowKey="id"
            pagination={false}
            size="small"
            scroll={{ x: "max-content" }}
            columns={[
              { title: "Collector", dataIndex: ["address", "name"] },
              { title: "Town", dataIndex: "address", render: (address: AdminPurchase["address"]) => `${address.city}, ${address.country}` },
              { title: "Starts", dataIndex: "startDate", render: (date: string) => formatMailDate(date, locale) },
              {
                title: "Progress",
                key: "progress",
                render: (_value, p) => (
                  <div style={{ display: "grid", gap: "0.25rem" }}>
                    <span>
                      {p.sentCount} of {p.cardCount} sent
                    </span>
                    {p.nextMailDate ? <span style={{ color: "#71717a" }}>next {formatMailDate(p.nextMailDate, locale)}</span> : null}
                  </div>
                ),
              },
              { title: "Paid", dataIndex: "priceCents", align: "right", render: (cents: number, p) => money(cents, p.currency) },
              { title: "Refunded", dataIndex: "refundedCents", align: "right", render: (cents: number, p) => (cents > 0 ? money(cents, p.currency) : "—") },
              { title: "Payment", dataIndex: "stripePaymentIntentId", render: (pi: string | null) => (pi ? <span style={{ color: "#71717a" }}>{pi}</span> : "—") },
              { title: "Status", dataIndex: "status", render: (status: PurchaseStatus) => <Tag color={purchaseStatusColor(status)}>{purchaseStatusLabel(status)}</Tag> },
              { title: "Bought", dataIndex: "createdAt", render: (value: number) => formatDay(value, locale) },
            ]}
          />
        )}
      </Card>

      <Card title="Postcards">
        {postcards.length === 0 ? (
          <Empty description="Cards are written when a collector's payment is confirmed." image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table<AdminPostcard>
            dataSource={postcards}
            rowKey="id"
            pagination={false}
            size="small"
            scroll={{ x: "max-content" }}
            columns={[
              { title: "Mail date", dataIndex: "mailDate", render: (date: string) => formatMailDate(date, locale) },
              {
                title: "Card",
                dataIndex: "position",
                render: (position: number) => (
                  <>
                    {position} of {edition.cardCount}
                    {cardTitle.get(position) ? <span style={{ display: "block", color: "#71717a" }}>{cardTitle.get(position)}</span> : null}
                  </>
                ),
              },
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
                title: <span className="sr-only">Actions</span>,
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
