import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "antd";
import { addDaysIso, todayIso, type PostcardDesign, type Recipient } from "@shared/postcards";
import { formatMoney } from "@shared/money";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { DesignForm } from "@/components/postcard/DesignForm";
import { Recipients } from "@/components/postcard/Recipients";
import { Schedule } from "@/components/postcard/Schedule";
import { useStore } from "@/lib/useStore";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useCart } from "@/store/cart";
import { cx } from "@/lib/cx";
import postcard from "@/components/postcard/Postcard.module.css";
import styles from "./CreatePage.module.css";

/**
 * The product page. There is one product, and this is it: design some
 * postcards, decide who gets them and when, and put the batch in the cart.
 *
 * Everything here is one batch — every design goes to every recipient. A
 * buyer who wants two different sets makes two trips through this page, and
 * the cart holds both.
 */
export function CreatePage() {
  const store = useStore();
  const navigate = useNavigate();
  const add = useCart((s) => s.add);
  useDocumentTitle("Make a postcard");

  const [designs, setDesigns] = useState<PostcardDesign[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [startDate, setStartDate] = useState(todayIso);
  const [cadenceDays, setCadenceDays] = useState(7);

  // The first design mails on the start date, each later one N days after
  // the last. Derived, never stored, so changing the cadence moves every card.
  const scheduled = useMemo(
    () => designs.map((design, index) => ({ design, mailDate: addDaysIso(startDate, index * cadenceDays) })),
    [designs, startDate, cadenceDays],
  );

  const count = designs.length * recipients.length;
  const totalCents = count * store.postcardPriceCents;
  const price = (cents: number) => formatMoney(cents, store.currency, store.locale);

  // A day that has passed while the tab sat open is not a day to mail on.
  useEffect(() => {
    if (startDate < todayIso()) setStartDate(todayIso());
  }, [startDate]);

  const addToCart = () => {
    add({
      designs: scheduled.map(({ design, mailDate }) => ({ designId: design.id, mailDate })),
      recipients,
    });
    void navigate("/cart");
  };

  return (
    <PageWrapper width="wide">
      <h1>Make a postcard</h1>

      <section className={cx(styles.panel)} aria-labelledby="design-heading">
        <h2 id="design-heading">1. Create a postcard design</h2>
        <DesignForm onSaved={(design) => setDesigns((current) => [...current, design])} />
      </section>

      <section className={cx(styles.panel)} aria-labelledby="schedule-heading">
        <h2 id="schedule-heading">2. Postcard schedule</h2>
        <Schedule
          items={scheduled}
          startDate={startDate}
          cadenceDays={cadenceDays}
          onStartDateChange={setStartDate}
          onCadenceChange={setCadenceDays}
          onRemove={(index) => setDesigns((current) => current.filter((_, i) => i !== index))}
          locale={store.locale}
        />
      </section>

      <section className={cx(styles.panel)} aria-labelledby="recipients-heading">
        <h2 id="recipients-heading">3. Postcard recipients</h2>
        <Recipients recipients={recipients} onChange={setRecipients} />
      </section>

      <section className={cx(styles.panel)} aria-labelledby="total-heading">
        <h2 id="total-heading" className="sr-only">
          Total
        </h2>
        <p className={postcard.total}>
          <span>
            <span className={postcard.count}>{designs.length}</span> design{designs.length === 1 ? "" : "s"}
          </span>
          <span>×</span>
          <span>
            <span className={postcard.count}>{recipients.length}</span> recipient{recipients.length === 1 ? "" : "s"}
          </span>
          <span>×</span>
          <span>{price(store.postcardPriceCents)} each</span>
          <span>=</span>
          <strong>{price(totalCents)}</strong>
        </p>
        <div className={postcard.totalActions}>
          <Button type="primary" size="large" disabled={count === 0} onClick={addToCart}>
            Add to cart
          </Button>
          {count === 0 ? (
            <span className={postcard.note}>Save at least one design and add at least one recipient.</span>
          ) : (
            <span className={postcard.note}>
              {count} postcard{count === 1 ? "" : "s"} in this batch. You can add another batch from the cart.
            </span>
          )}
        </div>
      </section>
    </PageWrapper>
  );
}
