import { Button, Skeleton } from "antd";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { GalleryTile } from "@/components/platform/ArtistTile";
import { useGallery } from "@/lib/platform";
import { useStore } from "@/lib/useStore";
import platform from "@/components/platform/Platform.module.css";

/** What recently went out in the post, newest first, a page at a time. Each card appears once, from the day it first went. */
export function GalleryPage() {
  const store = useStore();
  const gallery = useGallery(24);
  const cards = gallery.data?.pages.flatMap((page) => page.cards) ?? [];

  return (
    <PageWrapper width="wide">
      <h1>Gallery</h1>
      <p>Postcards recently mailed to collectors. The card in the letterbox is the real thing; this is the echo.</p>

      {gallery.isPending ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : cards.length === 0 ? (
        <p className={platform.empty}>Nothing has been mailed yet.</p>
      ) : (
        <>
          <div className={platform.galleryGrid}>
            {cards.map((card) => (
              <GalleryTile key={card.editionCardId} card={card} locale={store.locale} />
            ))}
          </div>
          {gallery.hasNextPage ? (
            <p style={{ textAlign: "center", marginTop: "2rem" }}>
              <Button loading={gallery.isFetchingNextPage} onClick={() => void gallery.fetchNextPage()}>
                More
              </Button>
            </p>
          ) : null}
        </>
      )}
    </PageWrapper>
  );
}
