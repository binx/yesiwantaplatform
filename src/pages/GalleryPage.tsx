import { Link } from "react-router-dom";
import { Button, Skeleton } from "antd";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { EditionTile } from "@/components/platform/ArtistTile";
import { useGallery } from "@/lib/platform";
import { usePageTitle } from "@/lib/usePageTitle";
import { useStore } from "@/lib/useStore";
import platform from "@/components/platform/Platform.module.css";

/**
 * Every edition on sale, newest first, a page at a time. Never the cards:
 * what arrives is the surprise, and this is where you pick whose.
 */
export function GalleryPage() {
  const store = useStore();
  const gallery = useGallery(24);
  usePageTitle("Gallery");
  const editions = gallery.data?.pages.flatMap((page) => page.editions) ?? [];

  return (
    <PageWrapper width="wide">
      <h1>Gallery</h1>

      {gallery.isPending ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : gallery.isError ? (
        <p className={platform.empty}>The gallery could not be loaded. Try again in a moment.</p>
      ) : editions.length === 0 ? (
        <p className={platform.empty}>
          Nothing is on sale yet. <Link to="/open-a-studio">Are you an artist?</Link>
        </p>
      ) : (
        <>
          <div className={`${platform.grid} ${platform.gridWide}`}>
            {editions.map((edition) => (
              <EditionTile key={edition.id} edition={edition} artist={edition.artist} locale={store.locale} />
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
