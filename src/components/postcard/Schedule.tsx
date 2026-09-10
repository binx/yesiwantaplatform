import { useId, useState } from "react";
import { Button, InputNumber, Popover, Segmented, Select } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { DELIVERY_BUSINESS_DAYS, businessDaysBeforeIso, todayIso, type PostcardDesign } from "@shared/postcards";
import { ProductImage } from "@/components/ui/ProductImage";
import { formatMailDate } from "@/lib/postcards";
import { cx } from "@/lib/cx";
import styles from "./Postcard.module.css";

/**
 * When each design goes out.
 *
 * Two ways to say it. *Spread them out* is one start date and a cadence —
 * the first design mails on the start date, the second N days later, and so
 * on — which is the site's headline use, a batch over weeks. *Pick each
 * date* is a date per design, for the dates that mean something: a birthday,
 * the twelve days of Christmas, a countdown. The cart carries a date per
 * design either way; only this control decides how they are chosen.
 */
export type ScheduleMode = "cadence" | "custom";

export interface ScheduledDesignView {
  design: PostcardDesign;
  mailDate: string;
}

interface ScheduleProps {
  items: ScheduledDesignView[];
  mode: ScheduleMode;
  startDate: string;
  cadenceDays: number;
  onModeChange: (mode: ScheduleMode) => void;
  onStartDateChange: (date: string) => void;
  onCadenceChange: (days: number) => void;
  /** A date typed for one design, in custom mode. */
  onDateChange: (designId: string, date: string) => void;
  /** A mail date worked back from the day a card should land. */
  onArriveBy: (designId: string, mailDate: string) => void;
  onRemove: (index: number) => void;
  locale: string;
}

export function Schedule({
  items,
  mode,
  startDate,
  cadenceDays,
  onModeChange,
  onStartDateChange,
  onCadenceChange,
  onDateChange,
  onArriveBy,
  onRemove,
  locale,
}: ScheduleProps) {
  const dateId = useId();
  const cadenceId = useId();
  const today = todayIso();

  // With one design the two modes are the same thing, so the toggle and the
  // per-design inputs only appear once there is a second card to schedule.
  const perDesign = mode === "custom" && items.length > 1;

  return (
    <div>
      {items.length === 0 ? (
        <p className={styles.empty}>No saved designs yet.</p>
      ) : (
        <>
          {items.length > 1 ? (
            <Segmented<ScheduleMode>
              className={cx(styles.scheduleMode)}
              aria-label="Schedule mode"
              value={mode}
              onChange={onModeChange}
              options={[
                { label: "Spread them out", value: "cadence" },
                { label: "Pick each date", value: "custom" },
              ]}
            />
          ) : null}

          {perDesign ? (
            <p className={styles.scheduleControls}>Choose a mail date under each design.</p>
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
        </>
      )}

      <ul className={styles.designList}>
        {items.map((item, index) => (
          <li key={item.design.id} className={styles.designItem}>
            <ProductImage image={item.design.thumbnail} sizes="120px" decorative />
            {perDesign ? (
              <input
                className={cx(styles.dateInput, styles.designDate)}
                type="date"
                min={today}
                value={item.mailDate}
                aria-label={`Mail date for design ${index + 1}`}
                onChange={(event) => onDateChange(item.design.id, event.target.value || today)}
              />
            ) : null}
            <div className={styles.designMeta}>
              <span>{perDesign ? "" : formatMailDate(item.mailDate, locale)}</span>
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
        <p className={styles.note}>
          Postcards are typically delivered about a week after they are mailed.{" "}
          <ArriveBy items={items} locale={locale} onArriveBy={onArriveBy} />
        </p>
      ) : null}
    </div>
  );
}

/**
 * "I want one to arrive on a day": the mail date worked back from the day
 * the card should land, six business days earlier. The estimate is the
 * same one the note above gives; this just does the subtraction so a
 * birthday card is not mailed on the birthday.
 */
function ArriveBy({
  items,
  locale,
  onArriveBy,
}: {
  items: ScheduledDesignView[];
  locale: string;
  onArriveBy: (designId: string, mailDate: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [designId, setDesignId] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const targetId = useId();
  const today = todayIso();

  const chosen = designId && items.some((item) => item.design.id === designId) ? designId : (items[0]?.design.id ?? null);
  const wanted = target ? businessDaysBeforeIso(target, DELIVERY_BUSINESS_DAYS) : null;
  const mailDate = wanted && wanted < today ? today : wanted;
  const tight = wanted !== null && wanted < today;

  const content = (
    <div className={styles.arriveBy}>
      {items.length > 1 ? (
        <Select
          aria-label="Which design"
          value={chosen}
          onChange={setDesignId}
          options={items.map((item, index) => ({ value: item.design.id, label: `Design ${index + 1}` }))}
        />
      ) : null}
      <label htmlFor={targetId}>Arrive on</label>
      <input id={targetId} className={styles.dateInput} type="date" min={today} value={target} onChange={(event) => setTarget(event.target.value)} />
      {mailDate ? (
        <p className={styles.note}>
          {tight
            ? `That is soon — mailed today, it may arrive a day or two after ${formatMailDate(target, locale)}.`
            : `We'll mail it on ${formatMailDate(mailDate, locale)} so it should arrive around ${formatMailDate(target, locale)}.`}
        </p>
      ) : null}
      <Button
        type="primary"
        size="small"
        disabled={!mailDate || !chosen}
        onClick={() => {
          if (mailDate && chosen) onArriveBy(chosen, mailDate);
          setOpen(false);
          setTarget("");
        }}
      >
        Use this date
      </Button>
    </div>
  );

  return (
    <Popover trigger="click" open={open} onOpenChange={setOpen} content={content} title="Arrive by a day">
      <Button type="link" size="small" className={cx(styles.arriveByLink)}>
        I want one to arrive on a day
      </Button>
    </Popover>
  );
}
