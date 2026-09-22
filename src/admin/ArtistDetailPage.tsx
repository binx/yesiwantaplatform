import { Link, useParams } from "react-router-dom";
import { App, Button, Card, Descriptions, Empty, Popconfirm, Skeleton, Table, Tag } from "antd";
import { artistLinkLabel, type ArtistStatus, type Mailing, type Subscription } from "@shared/platform";
import { formatMoney } from "@shared/money";
import { formatRecipient } from "@shared/postcards";
import { useAdminArtist, useSetAdminArtistStatus, useStoreLocale } from "./queries";
import { PageHeader } from "./RequireAdmin";
import { formatDay, formatMailDate, subscriptionStatusLabel } from "@/lib/postcards";

const statusColor = (status: ArtistStatus): string => (status === "live" ? "green" : status === "paused" ? "gold" : "default");

/** One artist: their page, their queue, their subscribers, and the pause switch. */
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

  const { artist, mailings, subscriptions } = detail.data;
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
            · <Tag color={statusColor(artist.status)}>{artist.status}</Tag>
          </>
        }
        actions={
          <>
            {artist.status === "live" ? (
              <Popconfirm title="Pause this artist?" description="No new subscriptions. Existing subscribers still get queued cards." onConfirm={() => change("paused")}>
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

      <Card title="Page" style={{ marginBottom: "1.25rem" }}>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="Tagline">{artist.tagline ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="Price">{formatMoney(artist.monthlyPriceCents, artist.currency, locale)} a month</Descriptions.Item>
          <Descriptions.Item label="Term">{artist.termMonths} {artist.termMonths === 1 ? "month" : "months"}</Descriptions.Item>
          <Descriptions.Item label="Send day">{artist.sendDay}th</Descriptions.Item>
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
          <Descriptions.Item label="Subscribers">{artist.subscriberCount} active</Descriptions.Item>
          <Descriptions.Item label="Cards mailed">{artist.mailedCount}</Descriptions.Item>
          <Descriptions.Item label="Payouts">{artist.payoutsEnabled ? <Tag color="green">ready</Tag> : artist.stripeAccountId ? <Tag color="gold">onboarding {artist.stripeAccountId}</Tag> : <Tag>no Stripe account</Tag>}</Descriptions.Item>
          <Descriptions.Item label="Since">{formatDay(artist.createdAt, locale)}</Descriptions.Item>
        </Descriptions>
        {artist.bio ? <pre style={{ whiteSpace: "pre-wrap", marginTop: "1rem", fontFamily: "inherit" }}>{artist.bio}</pre> : null}
      </Card>

      <Card title="Mailings" style={{ marginBottom: "1.25rem" }}>
        {mailings.length === 0 ? (
          <Empty description="Nothing queued or mailed." image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table<Mailing>
            dataSource={mailings}
            rowKey="id"
            pagination={false}
            size="small"
            scroll={{ x: "max-content" }}
            columns={[
              { title: "Date", dataIndex: "mailDate", render: (date: string, mailing) => <Link to={`/admin/mailings/${mailing.id}`}>{formatMailDate(date, locale)}</Link> },
              { title: "Title", dataIndex: "title", render: (title: string | null) => title ?? "—" },
              { title: "Status", dataIndex: "status", render: (status: string) => <Tag>{status}</Tag> },
              { title: "Subscribers", dataIndex: "subscriberCount", align: "right" },
              { title: "Sent", dataIndex: ["postcards", "sent"], align: "right" },
              { title: "Failed", dataIndex: ["postcards", "error"], align: "right", render: (n: number) => (n > 0 ? <Tag color="red">{n}</Tag> : n) },
            ]}
          />
        )}
      </Card>

      <Card title="Subscribers">
        {subscriptions.length === 0 ? (
          <Empty description="Nobody yet." image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table<Subscription>
            dataSource={subscriptions}
            rowKey="id"
            pagination={false}
            size="small"
            scroll={{ x: "max-content" }}
            columns={[
              { title: "Name", dataIndex: ["address", "name"] },
              { title: "Address", dataIndex: "address", render: (address: Subscription["address"]) => formatRecipient(address, locale) },
              { title: "Status", dataIndex: "status", render: (_status: string, s) => <Tag>{subscriptionStatusLabel(s.status, s.cancelAtPeriodEnd)}</Tag> },
              { title: "Pays", dataIndex: "priceCents", align: "right", render: (cents: number, s) => formatMoney(cents, s.currency, locale) },
              { title: "Since", dataIndex: "createdAt", render: (value: number) => formatDay(value, locale) },
            ]}
          />
        )}
      </Card>
    </>
  );
}
