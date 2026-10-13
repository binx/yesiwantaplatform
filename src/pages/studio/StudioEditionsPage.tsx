import { Link } from "react-router-dom";
import { Alert, Button, Skeleton, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { EditionStatus, EditionStudio } from "@shared/platform";
import { formatMoney } from "@shared/money";
import { ProductImage } from "@/components/ui/ProductImage";
import { useStudioEditions } from "@/lib/platform";
import { useStore } from "@/lib/useStore";
import { editionShape } from "@/lib/postcards";
import styles from "./Studio.module.css";

/** "on sale", in a tag the colour of the state. */
export function EditionStatusTag({ status }: { status: EditionStatus }) {
  const [color, label] = status === "on_sale" ? ["green", "On sale"] : status === "closed" ? ["gold", "Closed"] : status === "in_review" ? ["blue", "In review"] : ["default", "Draft"];
  return <Tag color={color}>{label}</Tag>;
}

/** The editions: the sets collectors buy, each with how far along it is. */
export function StudioEditionsPage() {
  const editions = useStudioEditions();

  return (
    <div>
      <section aria-labelledby="editions-heading">
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
          <p className={styles.empty}>No editions yet.</p>
        ) : (
          <ul className={styles.editionList}>
            {editions.data.map((edition) => (
              <EditionRow key={edition.id} edition={edition} />
            ))}
          </ul>
        )}
      </section>
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
          {editionShape(edition.cardCount)} · {formatMoney(edition.priceCents, edition.currency, store.locale)}
        </p>
        <p className={styles.note}>
          {edition.status === "draft"
            ? edition.reviewNote
              ? "Not approved. See the note on it."
              : missing > 0
                ? `${edition.cards.length} of ${edition.cardCount} cards added.`
                : edition.banner
                  ? "Every card added. Ready to send for review."
                  : "Every card added. Add a banner to send it for review."
            : edition.status === "in_review"
              ? "Being reviewed."
              : `${edition.collectorCount} ${edition.collectorCount === 1 ? "collector" : "collectors"} · ${edition.sentCount} sent · ${edition.scheduledCount} to come`}
        </p>
      </div>
    </li>
  );
}
