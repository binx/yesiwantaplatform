import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { App, Button } from "antd";
import { useMutation } from "@tanstack/react-query";
import type { Order } from "@shared/orders";
import { csrfPost } from "@/lib/api";
import { useSession } from "@/lib/session";
import { addDaysIso, todayIso, type PostcardDesign, type Recipient } from "@shared/postcards";
import { formatMoney } from "@shared/money";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { DesignForm } from "@/components/postcard/DesignForm";
import { Recipients } from "@/components/postcard/Recipients";
import { Schedule, type ScheduleMode } from "@/components/postcard/Schedule";
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
  const { message } = App.useApp();
  useDocumentTitle("Make a postcard");

  /*
   * The one admin's own route: order the batch for free, no Stripe.
   *
   * The button only renders for an admin session, but that is a convenience
   * — the route itself is behind `requireAdmin`, and this hook costs a
   * shopper one small session probe that every storefront page makes anyway.
   */
  const session = useSession();
  const complimentary = useMutation({
    mutationFn: (line: { designs: { designId: string; mailDate: string }[]; recipients: Recipient[] }) =>
      csrfPost<{ order: Order }>("/admin/orders/complimentary", { lines: [line] }),
    onSuccess: ({ order }) => {
      message.success(`Ordered ${order.postcardCount} postcard${order.postcardCount === 1 ? "" : "s"} for free.`);
      void navigate(`/admin/orders/${order.id}`);
    },
    onError: (error: unknown) => void message.error(error instanceof Error ? error.message : "Could not place the order."),
  });

  const [designs, setDesigns] = useState<PostcardDesign[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [mode, setMode] = useState<ScheduleMode>("cadence");
  // Recipients USPS refused. Lob would refuse them too, after payment, so the batch waits.
  const [blocked, setBlocked] = useState(0);
  const [startDate, setStartDate] = useState(todayIso);
  const [cadenceDays, setCadenceDays] = useState(7);
  // Custom mode's dates, by design id. Kept even while cadence mode is showing,
  // so flipping the toggle twice does not lose what was typed.
  const [customDates, setCustomDates] = useState<Record<string, string>>({});

  // Cadence: the first design mails on the start date, each later one N days
  // after the last. Derived, never stored, so changing the cadence moves every
  // card. Custom: whatever was typed under each design.
  const cadenceDates = useMemo(
    () => designs.map((design, index) => ({ design, mailDate: addDaysIso(startDate, index * cadenceDays) })),
    [designs, startDate, cadenceDays],
  );
  const scheduled = useMemo(
    () => (mode === "custom" ? designs.map((design) => ({ design, mailDate: customDates[design.id] ?? todayIso() })) : cadenceDates),
    [mode, designs, customDates, cadenceDates],
  );

  const count = designs.length * recipients.length;
  const totalCents = count * store.postcardPriceCents;
  const price = (cents: number) => formatMoney(cents, store.currency, store.locale);

  // A day that has passed while the tab sat open is not a day to mail on.
  useEffect(() => {
    const today = todayIso();
    if (startDate < today) setStartDate(today);
    setCustomDates((current) => {
      const late = Object.entries(current).filter(([, date]) => date < today);
      if (late.length === 0) return current;
      return { ...current, ...Object.fromEntries(late.map(([id]) => [id, today])) };
    });
  }, [startDate, customDates]);

  // Switching to custom starts from the dates the buyer could already see.
  const changeMode = (next: ScheduleMode) => {
    if (next === "custom" && mode !== "custom") {
      setCustomDates(Object.fromEntries(cadenceDates.map(({ design, mailDate }) => [design.id, mailDate])));
    }
    setMode(next);
  };

  const setCustomDate = (designId: string, date: string) =>
    setCustomDates((current) => ({ ...current, [designId]: date }));

  // A design saved in custom mode picks up the latest date already chosen:
  // the fifth card of a countdown moves on from the fourth, not from today.
  const addDesign = (design: PostcardDesign) => {
    setDesigns((current) => [...current, design]);
    if (mode === "custom") {
      setCustomDates((current) => {
        const latest = Object.values(current).sort().at(-1) ?? todayIso();
        return { ...current, [design.id]: latest };
      });
    }
  };

  const arriveBy = (designId: string, mailDate: string) => {
    if (mode === "cadence" && designs.length === 1) {
      setStartDate(mailDate);
      return;
    }
    changeMode("custom");
    setCustomDate(designId, mailDate);
  };

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
        <DesignForm onSaved={addDesign} />
      </section>

      <section className={cx(styles.panel)} aria-labelledby="schedule-heading">
        <h2 id="schedule-heading">2. Postcard schedule</h2>
        <Schedule
          items={scheduled}
          mode={mode}
          startDate={startDate}
          cadenceDays={cadenceDays}
          onModeChange={changeMode}
          onStartDateChange={setStartDate}
          onCadenceChange={setCadenceDays}
          onDateChange={setCustomDate}
          onArriveBy={arriveBy}
          onRemove={(index) => setDesigns((current) => current.filter((_, i) => i !== index))}
          locale={store.locale}
        />
      </section>

      <section className={cx(styles.panel)} aria-labelledby="recipients-heading">
        <h2 id="recipients-heading">3. Postcard recipients</h2>
        <Recipients recipients={recipients} onChange={setRecipients} onBlockedChange={setBlocked} />
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
          <Button type="primary" size="large" disabled={count === 0 || blocked > 0} onClick={addToCart}>
            Add to cart
          </Button>
          {session.data?.isAdmin ? (
            <Button
              size="large"
              disabled={count === 0}
              loading={complimentary.isPending}
              onClick={() =>
                complimentary.mutate({
                  designs: scheduled.map(({ design, mailDate }) => ({ designId: design.id, mailDate })),
                  recipients,
                })
              }
            >
              Send for free (admin)
            </Button>
          ) : null}
          {count === 0 ? (
            <span className={postcard.note}>Save at least one design and add at least one recipient.</span>
          ) : blocked > 0 ? (
            <span className={postcard.note}>
              {blocked} address{blocked === 1 ? "" : "es"} need{blocked === 1 ? "s" : ""} checking before this batch can go in the cart.
            </span>
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
