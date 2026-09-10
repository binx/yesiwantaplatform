import { useId, useState } from "react";
import { Button, Checkbox, Drawer, InputNumber, Popover, Segmented, Select } from "antd";
import { CalendarOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { addDaysIso, todayIso, type PostcardDesign } from "@shared/postcards";
import { DELIVERY_ESTIMATE } from "@shared/copy";
import { ProductImage } from "@/components/ui/ProductImage";
import { formatMailDate } from "@/lib/postcards";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { cx } from "@/lib/cx";
import styles from "./Postcard.module.css";

/** Below this, the popover has nowhere to open into without covering the thumbnails. */
const MOBILE_QUERY = "(max-width: 800px)";

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
  onEdit: (index: number) => void;
  locale: string;
  /** Print a QR code on the back so the recipient can see the card online and send one back. */
  replyLink: boolean;
  onReplyLinkChange: (on: boolean) => void;
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
  onEdit,
  locale,
  replyLink,
  onReplyLinkChange,
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
            <p className={styles.scheduleControls}>
              Choose a mail date under each design.
              <ArriveBy items={items} locale={locale} onArriveBy={onArriveBy} />
            </p>
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
              <ArriveBy items={items} locale={locale} onArriveBy={onArriveBy} />
            </div>
          )}
        </>
      )}

      <ul className={styles.designList}>
        {items.map((item, index) => (
          <li key={item.design.id} className={styles.designItem}>
            <ProductImage image={item.design.thumbnail} sizes="120px" decorative />
            {perDesign ? (
              <div className={styles.designControls}>
                <input
                  className={cx(styles.dateInput, styles.designDate)}
                  type="date"
                  min={today}
                  value={item.mailDate}
                  aria-label={`Mail date for design ${index + 1}`}
                  onChange={(event) => onDateChange(item.design.id, event.target.value || today)}
                />
                <div className={styles.designMeta}>
                  <span className={styles.designButtons}>
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      aria-label={`Edit design ${index + 1}`}
                      onClick={() => onEdit(index)}
                    />
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined />}
                      aria-label={`Remove design ${index + 1}`}
                      onClick={() => onRemove(index)}
                    />
                  </span>
                </div>
              </div>
            ) : (
              <div className={styles.designMeta}>
                <span>{formatMailDate(item.mailDate, locale)}</span>
                <span className={styles.designButtons}>
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    aria-label={`Edit design ${index + 1}`}
                    onClick={() => onEdit(index)}
                  />
                  <Button
                    type="text"
                    size="small"
                    icon={<DeleteOutlined />}
                    aria-label={`Remove design ${index + 1}`}
                    onClick={() => onRemove(index)}
                  />
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>

      {items.length > 0 ? (
        <>
          <p className={styles.note}>{DELIVERY_ESTIMATE}</p>
          <p className={styles.replyOption}>
            <Checkbox checked={replyLink} onChange={(event) => onReplyLinkChange(event.target.checked)}>
              Print a small QR code on the back, so they can see the card online and send one back.
            </Checkbox>
          </p>
        </>
      ) : null}
    </div>
  );
}

/**
 * "Send it ahead of a date": the buyer names the day that matters and how
 * many days early to mail, and the mail date is that subtraction. No
 * arrival is promised — how long a card takes depends on how far it
 * travels from the printer and on USPS, anywhere from a couple of days to
 * a week or more — so the lead is theirs to choose, with a week as the
 * starting point.
 */
const DEFAULT_LEAD_DAYS = 7;

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
  const [lead, setLead] = useState(DEFAULT_LEAD_DAYS);
  const targetId = useId();
  const leadId = useId();
  const today = todayIso();

  const chosen = designId && items.some((item) => item.design.id === designId) ? designId : (items[0]?.design.id ?? null);
  const wanted = target ? addDaysIso(target, -lead) : null;
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
      <label htmlFor={targetId}>The day that matters</label>
      <input id={targetId} className={styles.dateInput} type="date" min={today} value={target} onChange={(event) => setTarget(event.target.value)} />
      <label htmlFor={leadId}>Mail it this many days before</label>
      <InputNumber
        id={leadId}
        min={1}
        max={30}
        value={lead}
        onChange={(value) => setLead(typeof value === "number" && value >= 1 ? Math.floor(value) : DEFAULT_LEAD_DAYS)}
        suffix={lead === 1 ? "day" : "days"}
        className={cx(styles.cadence)}
      />
      {mailDate ? (
        <p className={styles.note}>
          {tight
            ? `That's soon: it would be mailed today, and may arrive after ${formatMailDate(target, locale)}.`
            : `Mails ${formatMailDate(mailDate, locale)}. How long it takes from there depends on how far it travels and on USPS — a couple of days, or a week or more.`}
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

  const isMobile = useMediaQuery(MOBILE_QUERY);

  if (isMobile) {
    return (
      <>
        <Button icon={<CalendarOutlined aria-hidden />} onClick={() => setOpen(true)}>
          Land it by a date
        </Button>
        <Drawer placement="bottom" open={open} onClose={() => setOpen(false)} title="Ahead of a date">
          {content}
        </Drawer>
      </>
    );
  }

  return (
    <Popover trigger="click" open={open} onOpenChange={setOpen} content={content} title="Ahead of a date">
      <Button icon={<CalendarOutlined aria-hidden />}>Land it by a date</Button>
    </Popover>
  );
}
