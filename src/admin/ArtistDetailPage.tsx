import { Link, useParams } from "react-router-dom";
import { App, Button, Card, Descriptions, Empty, Popconfirm, Skeleton, Table, Tag } from "antd";
import { artistLinkLabel, type ArtistStatus, type EditionStatus, type EditionStudio, type PurchaseStatus } from "@shared/platform";
import { formatMoney } from "@shared/money";
import { formatRecipient } from "@shared/postcards";
import { useAdminArtist, useSetAdminArtistStatus, useStoreLocale, type AdminArtistDetail, type AdminPurchase } from "./queries";
import { PageHeader } from "./RequireAdmin";
import { ReviewDecision } from "./ReviewDecision";
import { editionShape, formatDay, purchaseStatusLabel } from "@/lib/postcards";

const statusColor = (status: ArtistStatus): string => (status === "live" ? "green" : status === "paused" ? "gold" : "default");
const editionStatusColor = (status: EditionStatus): string => (status === "on_sale" ? "green" : status === "closed" ? "default" : status === "in_review" ? "purple" : "blue");
const reviewColor = (status: AdminArtistDetail["artist"]["reviewStatus"]): string => (status === "approved" ? "green" : status === "declined" ? "red" : "gold");

/** One artist: their page, their editions, who collected them, and the pause switch. */
export function ArtistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { message } = App.useApp();
  const locale = useStoreLocale();
  const detail = useAdminArtist(id);
  const setStatus = useSetAdminArtistStatus();


  if (detail.isPending) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (detail.isError || !detail.data) {
    return (
      <Empty description="No artist here.">
        <Link to="/admin/artists">
          <Button>Back to artists</Button>
        </Link>
      </Empty>
    );
  }

  const { artist, editions, purchases } = detail.data;
  const change = (status: ArtistStatus) => setStatus.mutate({ id: artist.id, status }, { onError: (error: unknown) => void message.error(error instanceof Error ? error.message : "Could not change that.") });

  return (
    <>
      <PageHeader
        title={artist.name}
        description={
          <>
            <a href={`/artist/${artist.slug}`} target="_blank" rel="noreferrer">
              /artist/{artist.slug}
            </a>{" "}
            · <Tag color={statusColor(artist.status)}>{artist.status}</Tag> <Tag color={reviewColor(artist.reviewStatus)}>{artist.reviewStatus}</Tag>
          </>
        }
        actions={
          <>
            {artist.status === "live" ? (
              <Popconfirm title="Pause this artist?" description="No new collectors on any edition. Everyone who already paid still gets every card." onConfirm={() => change("paused")}>
                <Button danger loading={setStatus.isPending}>
                  Pause
                </Button>
              </Popconfirm>
            ) : artist.status === "paused" ? (
              <Button loading={setStatus.isPending} onClick={() => change("live")}>
                Put back live
              </Button>
            ) : null}
            <Link to="/admin/artists">
              <Button>All artists</Button>
            </Link>
          </>
        }
      />

      <Card title="Review" style={{ marginBottom: "1.25rem" }}>
        <p style={{ marginTop: 0 }}>
          {artist.reviewStatus === "pending" ? "Waiting for a look." : artist.reviewStatus === "approved" ? "Approved: the page may go live." : "Declined: the artist can ask again once the page has changed."}
        </p>
        {artist.reviewNote ? <blockquote style={{ margin: "0 0 1rem", paddingLeft: "1rem", borderLeft: "3px solid #e4e4e7", whiteSpace: "pre-wrap" }}>{artist.reviewNote}</blockquote> : null}
        <ReviewDecision kind="artist" id={artist.id} name={artist.name} />
      </Card>

      <Card title="Page" style={{ marginBottom: "1.25rem" }}>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="Links">
            {artist.links.length === 0
              ? "—"
              : artist.links.map((link) => (
                  <div key={link.url}>
                    <a href={link.url} target="_blank" rel="noopener noreferrer nofollow">
                      {artistLinkLabel(link)}
                    </a>{" "}
                    <span style={{ color: "#71717a" }}>{link.url}</span>
                  </div>
                ))}
          </Descriptions.Item>
          <Descriptions.Item label="Collectors">{artist.collectorCount}</Descriptions.Item>
          <Descriptions.Item label="Cards mailed">{artist.mailedCount}</Descriptions.Item>
          <Descriptions.Item label="Payouts">{artist.payoutsEnabled ? <Tag color="green">ready</Tag> : artist.stripeAccountId ? <Tag color="gold">onboarding {artist.stripeAccountId}</Tag> : <Tag>no Stripe account</Tag>}</Descriptions.Item>
          <Descriptions.Item label="Since">{formatDay(artist.createdAt, locale)}</Descriptions.Item>
        </Descriptions>
        {artist.bio ? <pre style={{ whiteSpace: "pre-wrap", marginTop: "1rem", fontFamily: "inherit" }}>{artist.bio}</pre> : null}
      </Card>

      <Card title="Editions" style={{ marginBottom: "1.25rem" }}>
        {editions.length === 0 ? (
          <Empty description="No editions yet." image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table<EditionStudio>
            dataSource={editions}
            rowKey="id"
            pagination={false}
            size="small"
            scroll={{ x: "max-content" }}
            columns={[
              { title: "Title", dataIndex: "title", render: (title: string, edition) => <Link to={`/admin/editions/${edition.id}`}>{title}</Link> },
              { title: "Shape", key: "shape", render: (_value, edition) => editionShape(edition.cardCount) },
              { title: "Price", dataIndex: "priceCents", align: "right", render: (cents: number, edition) => formatMoney(cents, edition.currency, locale) },
              { title: "Status", dataIndex: "status", render: (status: EditionStatus) => <Tag color={editionStatusColor(status)}>{status === "on_sale" ? "on sale" : status === "in_review" ? "in review" : status}</Tag> },
              { title: "Collectors", dataIndex: "collectorCount", align: "right" },
              { title: "Sent", dataIndex: "sentCount", align: "right" },
              { title: "Still to come", dataIndex: "scheduledCount", align: "right" },
            ]}
          />
        )}
      </Card>

      <Card title="Purchases">
        {purchases.length === 0 ? (
          <Empty description="Nobody yet." image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table<AdminPurchase>
            dataSource={purchases}
            rowKey="id"
            pagination={false}
            size="small"
            scroll={{ x: "max-content" }}
            columns={[
              { title: "Collector", dataIndex: ["address", "name"] },
              { title: "Address", dataIndex: "address", render: (address: AdminPurchase["address"]) => formatRecipient(address, locale) },
              { title: "Edition", dataIndex: "edition", render: (edition: AdminPurchase["edition"]) => <Link to={`/admin/editions/${edition.id}`}>{edition.title}</Link> },
              { title: "Progress", key: "progress", render: (_value, p) => `${p.sentCount} of ${p.cardCount} sent` },
              { title: "Status", dataIndex: "status", render: (status: PurchaseStatus) => <Tag color={status === "paid" ? "green" : status === "refunded" ? "default" : "gold"}>{purchaseStatusLabel(status)}</Tag> },
              { title: "Paid", dataIndex: "priceCents", align: "right", render: (cents: number, p) => formatMoney(cents, p.currency, locale) },
              { title: "Refunded", dataIndex: "refundedCents", align: "right", render: (cents: number, p) => (cents > 0 ? formatMoney(cents, p.currency, locale) : "—") },
              { title: "Since", dataIndex: "createdAt", render: (value: number) => formatDay(value, locale) },
            ]}
          />
        )}
      </Card>
    </>
  );
}
