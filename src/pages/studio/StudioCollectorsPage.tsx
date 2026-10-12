import { Alert, Skeleton, Tag } from "antd";
import { useCollectors } from "@/lib/platform";
import { useStore } from "@/lib/useStore";
import { formatDay, formatMailDate, purchaseStatusLabel } from "@/lib/postcards";
import { cx } from "@/lib/cx";
import styles from "./Studio.module.css";

/**
 * Who collects what: a name and a town each, and how far along their cards are.
 *
 * The street is the platform's business, not the artist's — the API never
 * sends it here — which is what lets someone collect from a stranger.
 */
export function StudioCollectorsPage() {
  const store = useStore();
  const collectors = useCollectors();

  if (collectors.isPending) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (collectors.isError) return <Alert type="error" showIcon title="Your collectors could not be loaded." />;

  const receiving = collectors.data.filter((c) => c.status === "paid" && c.nextMailDate !== null).length;

  return (
    <div>
      <h2>Collectors</h2>
      <p className={styles.note} style={{ marginBottom: "1rem" }}>
        {receiving} with cards still to come. Addresses stay with us; you see a name and a town.
      </p>
      {collectors.data.length === 0 ? (
        <p className={styles.empty}>Nobody yet. Put an edition on sale and share your page.</p>
      ) : (
        <table className={cx(styles.table)}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Where</th>
              <th scope="col">Edition</th>
              <th scope="col">Progress</th>
              <th scope="col">Next card</th>
              <th scope="col">Since</th>
            </tr>
          </thead>
          <tbody>
            {collectors.data.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>
                  {c.city}
                  {c.country !== "US" ? `, ${c.country}` : ""}
                </td>
                <td>{c.edition.title}</td>
                <td>
                  {c.sentCount} of {c.cardCount} sent
                  {c.status === "refunded" ? (
                    <>
                      {" "}
                      <Tag>{purchaseStatusLabel(c.status)}</Tag>
                    </>
                  ) : null}
                </td>
                <td>{c.nextMailDate ? formatMailDate(c.nextMailDate, store.locale) : "—"}</td>
                <td>{formatDay(c.since, store.locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
