import { Alert, Skeleton, Tag } from "antd";
import { useSubscribers } from "@/lib/platform";
import { useStore } from "@/lib/useStore";
import { formatDay, subscriptionStatusLabel } from "@/lib/postcards";
import { cx } from "@/lib/cx";
import styles from "./Studio.module.css";

/**
 * Who gets the mail: a name and a town each.
 *
 * The street is the platform's business, not the artist's — the API never
 * sends it here — which is what lets someone subscribe to a stranger.
 */
export function StudioSubscribersPage() {
  const store = useStore();
  const subscribers = useSubscribers();


  if (subscribers.isPending) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (subscribers.isError) return <Alert type="error" showIcon title="Your subscribers could not be loaded." />;

  const active = subscribers.data.filter((s) => s.status === "active").length;

  return (
    <div>
      <h2>Subscribers</h2>
      <p className={styles.note} style={{ marginBottom: "1rem" }}>
        {active} active. Addresses stay with us; you see a name and a town.
      </p>
      {subscribers.data.length === 0 ? (
        <p className={styles.empty}>Nobody yet. Share your page.</p>
      ) : (
        <table className={cx(styles.table)}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Where</th>
              <th scope="col">Since</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {subscribers.data.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>
                  {s.city}
                  {s.country !== "US" ? `, ${s.country}` : ""}
                </td>
                <td>{formatDay(s.since, store.locale)}</td>
                <td>
                  <Tag color={s.status === "active" ? "green" : s.status === "past_due" ? "red" : "default"}>{subscriptionStatusLabel(s.status)}</Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
