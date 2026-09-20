import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Empty, Segmented, Skeleton, Table, Tag } from "antd";
import type { ArtistStatus } from "@shared/platform";
import { formatMoney } from "@shared/money";
import { useAdminArtists, useStoreLocale, type AdminArtist } from "./queries";
import { PageHeader } from "./RequireAdmin";
import { formatDay } from "@/lib/postcards";

type Filter = ArtistStatus | "all";

function statusColor(status: ArtistStatus): string {
  return status === "live" ? "green" : status === "paused" ? "gold" : "default";
}

/** Every artist on the platform, whatever state their page is in. */
export function ArtistsPage() {
  const locale = useStoreLocale();
  const [filter, setFilter] = useState<Filter>("all");
  const artists = useAdminArtists(filter === "all" ? undefined : filter);

  useEffect(() => {
    document.title = "Artists · Admin";
  }, []);

  return (
    <>
      <PageHeader title="Artists" description="Everyone with a page. Pause an artist to stop new subscriptions; their existing subscribers still get queued cards." />
      <Segmented<Filter> value={filter} onChange={setFilter} options={[{ label: "All", value: "all" }, { label: "Live", value: "live" }, { label: "Paused", value: "paused" }, { label: "Draft", value: "draft" }]} style={{ marginBottom: "1rem" }} />
      {artists.isPending ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (artists.data?.artists.length ?? 0) === 0 ? (
        <Empty description="No artists here." />
      ) : (
        <Table<AdminArtist>
          dataSource={artists.data?.artists}
          rowKey="id"
          pagination={false}
          scroll={{ x: "max-content" }}
          columns={[
            { title: "Name", dataIndex: "name", render: (name: string, artist) => <Link to={`/admin/artists/${artist.id}`}>{name}</Link> },
            { title: "Address", dataIndex: "slug", render: (slug: string) => `/a/${slug}` },
            { title: "Status", dataIndex: "status", render: (status: ArtistStatus) => <Tag color={statusColor(status)}>{status}</Tag> },
            { title: "Price", dataIndex: "monthlyPriceCents", align: "right", render: (cents: number, artist) => formatMoney(cents, artist.currency, locale) },
            { title: "Subscribers", dataIndex: "subscriberCount", align: "right" },
            { title: "Mailed", dataIndex: "mailedCount", align: "right" },
            { title: "Payouts", dataIndex: "payoutsEnabled", render: (enabled: boolean, artist) => (enabled ? <Tag color="green">ready</Tag> : artist.hasStripeAccount ? <Tag color="gold">onboarding</Tag> : <Tag>not set up</Tag>) },
            { title: "Since", dataIndex: "createdAt", render: (value: number) => formatDay(value, locale) },
          ]}
        />
      )}
    </>
  );
}
