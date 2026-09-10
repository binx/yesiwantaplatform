import { useId } from "react";
import { Button, InputNumber } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { todayIso, type PostcardDesign } from "@shared/postcards";
import { ProductImage } from "@/components/ui/ProductImage";
import { formatMailDate } from "@/lib/postcards";
import { cx } from "@/lib/cx";
import styles from "./Postcard.module.css";

/**
 * When each design goes out.
 *
 * One start date and a cadence: the first design mails on the start date,
 * the second N days later, and so on. That is the whole idea of the site —
 * a batch spread out over weeks — so the control is deliberately that
 * simple rather than a date per card.
 */
export interface ScheduledDesignView {
  design: PostcardDesign;
  mailDate: string;
}

interface ScheduleProps {
  items: ScheduledDesignView[];
  startDate: string;
  cadenceDays: number;
  onStartDateChange: (date: string) => void;
  onCadenceChange: (days: number) => void;
  onRemove: (index: number) => void;
  locale: string;
}

export function Schedule({
  items,
  startDate,
  cadenceDays,
  onStartDateChange,
  onCadenceChange,
  onRemove,
  locale,
}: ScheduleProps) {
  const dateId = useId();
  const cadenceId = useId();
  const today = todayIso();

  return (
    <div>
      {items.length === 0 ? (
        <p className={styles.empty}>No saved designs yet.</p>
      ) : (
        <div className={styles.scheduleControls}>
          <label htmlFor={dateId}>{items.length > 1 ? "Mail the first one on" : "Mail it on"}</label>
          <input
            id={dateId}
            className={styles.dateInput}
            type="date"
            min={today}
            value={startDate}
            onChange={(event) => onStartDateChange(event.target.value || today)}
          />
          {items.length > 1 ? (
            <>
              <label htmlFor={cadenceId}>and then one every</label>
              <InputNumber
                id={cadenceId}
                min={1}
                max={90}
                value={cadenceDays}
                onChange={(value) => onCadenceChange(typeof value === "number" && value >= 1 ? Math.floor(value) : 1)}
                suffix={cadenceDays === 1 ? "day" : "days"}
                className={cx(styles.cadence)}
              />
            </>
          ) : null}
        </div>
      )}

      <ul className={styles.designList}>
        {items.map((item, index) => (
          <li key={item.design.id} className={styles.designItem}>
            <ProductImage image={item.design.thumbnail} sizes="120px" decorative />
            <div className={styles.designMeta}>
              <span>{formatMailDate(item.mailDate, locale)}</span>
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                aria-label={`Remove design ${index + 1}`}
                onClick={() => onRemove(index)}
              />
            </div>
          </li>
        ))}
      </ul>

      {items.length > 0 ? (
        <p className={styles.note}>Postcards are typically delivered about a week after they are mailed.</p>
      ) : null}
    </div>
  );
}
