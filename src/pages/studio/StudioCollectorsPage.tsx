import { Alert, Skeleton } from "antd";
import { useCollectors, type StudioView } from "@/lib/platform";
import { useOutletContext } from "react-router-dom";
import type { Collector } from "@shared/platform";
import { cx } from "@/lib/cx";
import styles from "./Studio.module.css";

/**
 * How many people collect each edition, and how many cards are still to go.
 *
 * Never who. The names and addresses are the platform's business — the API
 * doesn't send them here — which is what lets someone collect from a
 * stranger. The artist gets numbers.
 */
export function StudioCollectorsPage() {
  const { artist } = useOutletContext<StudioView>();
  const collectors = useCollectors();

  if (collectors.isPending) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (collectors.isError) return <Alert type="error" showIcon title="Your collectors could not be loaded." />;

  const receiving = collectors.data.filter(stillReceiving).length;
  const editions = byEdition(collectors.data);

  return (
    <div>
      <h2>Collectors</h2>
      <p className={styles.note} style={{ marginBottom: "1rem" }}>
        {artist.collectorCount} {artist.collectorCount === 1 ? "person has" : "people have"} collected from you; {receiving} still {receiving === 1 ? "has" : "have"} cards to come. Who they are and where their
        cards go stays with us.
      </p>
      {editions.length === 0 ? (
        <p className={styles.empty}>Nobody yet. Put an edition on sale and share your page.</p>
      ) : (
        <table className={cx(styles.table)}>
          <thead>
            <tr>
              <th scope="col">Edition</th>
              <th scope="col" className={styles.amount}>
                Collectors
              </th>
              <th scope="col" className={styles.amount}>
                Still receiving
              </th>
              <th scope="col" className={styles.amount}>
                Cards to come
              </th>
            </tr>
          </thead>
          <tbody>
            {editions.map((edition) => (
              <tr key={edition.id}>
                <td>{edition.title}</td>
                <td className={styles.amount}>{edition.collectors}</td>
                <td className={styles.amount}>{edition.receiving}</td>
                <td className={styles.amount}>{edition.remaining}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function stillReceiving(purchase: Collector): boolean {
  return purchase.status === "paid" && purchase.nextMailDate !== null;
}

interface EditionTally {
  id: string;
  title: string;
  /** Purchases that were paid, including runs that have finished. A refund doesn't count. */
  collectors: number;
  receiving: number;
  remaining: number;
}

/** One line per edition, in the order its first collector arrived. */
function byEdition(purchases: Collector[]): EditionTally[] {
  const tallies = new Map<string, EditionTally>();
  for (const purchase of purchases) {
    const tally = tallies.get(purchase.edition.id) ?? { id: purchase.edition.id, title: purchase.edition.title, collectors: 0, receiving: 0, remaining: 0 };
    if (purchase.status === "paid") tally.collectors += 1;
    if (stillReceiving(purchase)) {
      tally.receiving += 1;
      tally.remaining += purchase.cardCount - purchase.sentCount;
    }
    tallies.set(purchase.edition.id, tally);
  }
  return [...tallies.values()];
}
