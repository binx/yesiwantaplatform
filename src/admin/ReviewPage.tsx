import { Link } from "react-router-dom";
import { Card, Empty, Skeleton, Tag } from "antd";
import { artistLinkLabel } from "@shared/platform";
import { formatMoney } from "@shared/money";
import { ProductImage } from "@/components/ui/ProductImage";
import { assetUrl } from "@/lib/store-source";
import { editionShape, formatDay } from "@/lib/postcards";
import { useAdminReviewQueue, useStoreLocale, type ReviewArtist, type ReviewEdition } from "./queries";
import { ReviewDecision } from "./ReviewDecision";
import { PageHeader } from "./RequireAdmin";

/**
 * The queue: every page the admin has not looked at, and every edition an
 * artist has sent, oldest first. Everything needed to decide is on this
 * page, so a decision is one visit: the page as a visitor would see it, the
 * edition with every card a collector would get.
 */
export function ReviewPage() {
  const locale = useStoreLocale();
  const queue = useAdminReviewQueue();

  return (
    <>
      <PageHeader title="Review" description="Pages and editions waiting on you, oldest first. A page comes before its editions: an edition can't be approved until its artist is." />

      {queue.isPending ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : queue.isError ? (
        <Empty description="The queue could not be loaded." />
      ) : (
        <>
          <Card title={`Artists (${queue.data.artists.length})`} style={{ marginBottom: "1.25rem" }}>
            {queue.data.artists.length === 0 ? (
              <Empty description="No pages waiting." image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div style={{ display: "grid", gap: "2rem" }}>
                {queue.data.artists.map((artist) => (
                  <ArtistToReview key={artist.id} artist={artist} locale={locale} />
                ))}
              </div>
            )}
          </Card>

          <Card title={`Editions (${queue.data.editions.length})`}>
            {queue.data.editions.length === 0 ? (
              <Empty description="No editions waiting." image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div style={{ display: "grid", gap: "2rem" }}>
                {queue.data.editions.map((edition) => (
                  <EditionToReview key={edition.id} edition={edition} locale={locale} />
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function ArtistToReview({ artist, locale }: { artist: ReviewArtist; locale: string }) {
  return (
    <section aria-labelledby={`review-artist-${artist.id}`} style={{ display: "grid", gap: "0.75rem" }}>
      {artist.banner ? <img src={assetUrl(artist.banner.path)} alt={artist.banner.alt} style={{ width: "100%", maxWidth: "48rem", aspectRatio: "3 / 1", objectFit: "cover", borderRadius: 4 }} /> : null}
      <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        {artist.avatar ? <img src={assetUrl(artist.avatar.path)} alt="" width={56} height={56} style={{ borderRadius: "50%", objectFit: "cover" }} /> : null}
        <div>
          <h2 id={`review-artist-${artist.id}`} style={{ margin: 0, fontSize: "1.125rem" }}>
            <Link to={`/admin/artists/${artist.id}`}>{artist.name}</Link>
          </h2>
          <p style={{ margin: 0, color: "#71717a" }}>
            /artist/{artist.slug} · opened {formatDay(artist.createdAt, locale)}
            {artist.visibility === "private" ? " · private" : ""}
            {artist.reviewNote ? " · declined before" : ""}
          </p>
        </div>
      </div>
      {artist.bioHtml ? <div dangerouslySetInnerHTML={{ __html: artist.bioHtml }} style={{ maxWidth: "48rem" }} /> : <p style={{ margin: 0, color: "#71717a" }}>No bio.</p>}
      {artist.links.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
          {artist.links.map((link) => (
            <li key={link.url}>
              <a href={link.url} target="_blank" rel="noopener noreferrer nofollow">
                {artistLinkLabel(link)}
              </a>{" "}
              <span style={{ color: "#71717a" }}>{link.url}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {artist.reviewNote ? <blockquote style={{ margin: 0, paddingLeft: "1rem", borderLeft: "3px solid #e4e4e7", whiteSpace: "pre-wrap" }}>{artist.reviewNote}</blockquote> : null}
      <ReviewDecision kind="artist" id={artist.id} name={artist.name} />
    </section>
  );
}

function EditionToReview({ edition, locale }: { edition: ReviewEdition; locale: string }) {
  const artistPending = edition.artist !== null && edition.artist.reviewStatus !== "approved";
  return (
    <section aria-labelledby={`review-edition-${edition.id}`} style={{ display: "grid", gap: "0.75rem" }}>
      {edition.banner ? <img src={assetUrl(edition.banner.path)} alt={edition.banner.alt} style={{ width: "100%", maxWidth: "48rem", aspectRatio: "3 / 1", objectFit: "cover", borderRadius: 4 }} /> : null}
      <div>
        <h2 id={`review-edition-${edition.id}`} style={{ margin: 0, fontSize: "1.125rem" }}>
          <Link to={`/admin/editions/${edition.id}`}>{edition.title}</Link>
        </h2>
        <p style={{ margin: 0, color: "#71717a" }}>
          {edition.artist ? (
            <>
              by <Link to={`/admin/artists/${edition.artist.id}`}>{edition.artist.name}</Link>
              {artistPending ? (
                <>
                  {" "}
                  <Tag color="gold">page {edition.artist.reviewStatus}</Tag>
                </>
              ) : null}
              {" · "}
            </>
          ) : null}
          {editionShape(edition.cardCount)} · {formatMoney(edition.priceCents, edition.currency, locale)}
          {edition.submittedAt ? ` · sent ${formatDay(edition.submittedAt, locale)}` : ""}
          {edition.inGallery ? "" : " · not for the gallery"}
        </p>
      </div>
      {edition.descriptionHtml ? <div dangerouslySetInnerHTML={{ __html: edition.descriptionHtml }} style={{ maxWidth: "48rem" }} /> : <p style={{ margin: 0, color: "#71717a" }}>No description.</p>}
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))", gap: "1rem" }}>
        {[...edition.cards]
          .sort((a, b) => a.position - b.position)
          .map((card) => (
            <li key={card.id}>
              <ProductImage image={card.design.thumbnail} sizes="176px" />
              <p style={{ margin: "0.5rem 0 0" }}>
                <strong>{card.position}.</strong> {card.title ?? <span style={{ color: "#71717a" }}>untitled</span>}
              </p>
            </li>
          ))}
      </ol>
      <ReviewDecision kind="edition" id={edition.id} name={edition.title} {...(artistPending ? { blocked: "Approve the artist's page first." } : {})} />
    </section>
  );
}
