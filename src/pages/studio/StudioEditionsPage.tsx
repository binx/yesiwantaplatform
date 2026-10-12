import { Link, useOutletContext } from "react-router-dom";
import { Alert, Button, Skeleton, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { EditionStatus, EditionStudio } from "@shared/platform";
import { formatMoney } from "@shared/money";
import { ProductImage } from "@/components/ui/ProductImage";
import { useStudioEditions, type StudioView } from "@/lib/platform";
import { useStore } from "@/lib/useStore";
import { editionShape } from "@/lib/postcards";
import { DesignLibrary } from "./StudioDesigns";
import styles from "./Studio.module.css";

/** "on sale", in a tag the colour of the state. */
export function EditionStatusTag({ status }: { status: EditionStatus }) {
  const [color, label] = status === "on_sale" ? ["green", "on sale"] : status === "closed" ? ["gold", "closed"] : ["default", "draft"];
  return <Tag color={color}>{label}</Tag>;
}

/**
 * Editions, and the postcards they are made of.
 *
 * Two lists. Editions are the sets collectors buy, each with how far along
 * its cards are. Postcards are the drawer: everything the artist has made,
 * ready to be put into an edition's cards.
 */
export function StudioEditionsPage() {
  const view = useOutletContext<StudioView>();
  const editions = useStudioEditions();

  return (
    <div>
      <section aria-labelledby="editions-heading" style={{ marginBottom: "2rem" }}>
        <div className={styles.sectionHeader}>
          <h2 id="editions-heading">Editions</h2>
          <Link to="/studio/editions/new">
            <Button type="primary" icon={<PlusOutlined />}>
              New edition
            </Button>
          </Link>
        </div>
        {editions.isPending ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : editions.isError ? (
          <Alert type="error" showIcon title="Your editions could not be loaded." />
        ) : editions.data.length === 0 ? (
          <p className={styles.empty}>No editions yet. An edition is a set of 6 or 12 postcards, mailed one by one, for one price. Start one, then fill its cards.</p>
        ) : (
          <ul className={styles.editionList}>
            {editions.data.map((edition) => (
              <EditionRow key={edition.id} edition={edition} />
            ))}
          </ul>
        )}
      </section>

      <DesignLibrary artistName={view.artist.name} />
    </div>
  );
}

function EditionRow({ edition }: { edition: EditionStudio }) {
  const store = useStore();
  const missing = edition.cardCount - edition.cards.length;

  return (
    <li className={styles.editionRow}>
      <div className={styles.editionCover}>{edition.banner ? <ProductImage image={edition.banner} ratio={3} sizes="200px" decorative /> : <div className={styles.coverEmpty} aria-hidden />}</div>
      <div className={styles.editionBody}>
        <p className={styles.editionTitle}>
          <Link to={`/studio/editions/${edition.id}`}>{edition.title}</Link> <EditionStatusTag status={edition.status} />
        </p>
        <p className={styles.note}>
          {editionShape(edition.cardCount, edition.cadence)} · {formatMoney(edition.priceCents, edition.currency, store.locale)}
        </p>
        <p className={styles.note}>
          {edition.status === "draft"
            ? missing > 0
              ? `${edition.cards.length} of ${edition.cardCount} cards chosen.`
              : edition.banner
                ? "Every card chosen. Ready to put on sale."
                : "Every card chosen. Add a banner to put it on sale."
            : `${edition.collectorCount} ${edition.collectorCount === 1 ? "collector" : "collectors"} · ${edition.sentCount} sent · ${edition.scheduledCount} to come`}
        </p>
      </div>
    </li>
  );
}
