import { Link } from "react-router-dom";
import { Skeleton } from "antd";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ArtistTile } from "@/components/platform/ArtistTile";
import { useArtists } from "@/lib/platform";
import { useStore } from "@/lib/useStore";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import platform from "@/components/platform/Platform.module.css";

/** The directory: every live artist, and what a month of their mail costs. */
export function ArtistsPage() {
  const store = useStore();
  const artists = useArtists();
  useDocumentTitle("Artists");

  return (
    <PageWrapper width="wide">
      <h1>Artists</h1>
      <p>Each one mails a postcard a month to everyone who said yes. Pick one, or a few.</p>

      {artists.isPending ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : artists.isError ? (
        <p className={platform.empty}>The artists could not be loaded. Try again in a moment.</p>
      ) : artists.data.length === 0 ? (
        <p className={platform.empty}>
          Nobody has gone live yet. <Link to="/for-artists">Are you an artist?</Link>
        </p>
      ) : (
        <div className={platform.grid}>
          {artists.data.map((artist) => (
            <ArtistTile key={artist.id} artist={artist} locale={store.locale} />
          ))}
        </div>
      )}
    </PageWrapper>
  );
}
