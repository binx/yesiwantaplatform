import { Link } from "react-router-dom";
import { Skeleton } from "antd";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ArtistTile } from "@/components/platform/ArtistTile";
import { useArtists } from "@/lib/platform";
import platform from "@/components/platform/Platform.module.css";

/** The directory: every live artist, and how many editions each has on sale. */
export function ArtistsPage() {
  const artists = useArtists();

  return (
    <PageWrapper width="wide">
      <h1>Artists</h1>

      {artists.isPending ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : artists.isError ? (
        <p className={platform.empty}>The artists could not be loaded. Try again in a moment.</p>
      ) : artists.data.length === 0 ? (
        <p className={platform.empty}>
          Nobody has gone live yet. <Link to="/open-a-studio">Are you an artist?</Link>
        </p>
      ) : (
        <div className={platform.grid}>
          {artists.data.map((artist) => (
            <ArtistTile key={artist.id} artist={artist} />
          ))}
        </div>
      )}
    </PageWrapper>
  );
}
