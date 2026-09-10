import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button } from "antd";
import { useMutation } from "@tanstack/react-query";
import type { Order } from "@shared/orders";
import { csrfPost } from "@/lib/api";
import { useDesigns } from "@/lib/designs";
import { fetchReplyCard } from "@/lib/reply";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
import { addDaysIso, isInternational, todayIso, type PostcardDesign, type Recipient } from "@shared/postcards";
import { formatMoney } from "@shared/money";
import type { CartLineInput } from "@shared/cart";
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
    mutationFn: (line: CartLineInput) => csrfPost<{ order: Order }>("/admin/orders/complimentary", { lines: [line] }),
    onSuccess: ({ order }) => {
      message.success(`Ordered ${order.postcardCount} postcard${order.postcardCount === 1 ? "" : "s"} for free.`);
      void navigate(`/admin/orders/${order.id}`);
    },
    onError: (error: unknown) => void message.error(error instanceof Error ? error.message : "Could not place the order."),
  });

  const [designs, setDesigns] = useState<PostcardDesign[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const editingDesign = editingIndex !== null ? (designs[editingIndex] ?? null) : null;

  // Designs handed in by the gallery's "send again": `?designs=a,b`. Fetched
  // once through the public designs route and seeded into the schedule; the
  // query string is then dropped so a reload does not seed them twice.
  const [params, setParams] = useSearchParams();
  const handedIn = useMemo(() => (params.get("designs") ?? "").split(",").map((id) => id.trim()).filter(Boolean), [params]);
  const incoming = useDesigns(handedIn);
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || handedIn.length === 0 || !incoming.data) return;
    seeded.current = true;
    const found = handedIn.map((id) => incoming.data.get(id)).filter((d): d is PostcardDesign => d !== undefined);
    if (found.length > 0) setDesigns((current) => [...current, ...found.filter((d) => !current.some((c) => c.id === d.id))]);
    if (found.length < handedIn.length) message.warning("One of the designs you chose is no longer available.");
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("designs");
      return next;
    }, { replace: true });
  }, [handedIn, incoming.data, message, setParams]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [replyLink, setReplyLink] = useState(true);
  const [mode, setMode] = useState<ScheduleMode>("cadence");

  // A reply: `?replyTo=CODE` from the page behind a card's QR. The recipient
  // is the card's sender, resolved on the server at checkout; here the
  // recipients section is locked to their name and nothing else.
  const replyTo = params.get("replyTo") ?? null;
  const replyCard = useQuery({
    queryKey: ["reply-card", replyTo],
    queryFn: ({ signal }) => fetchReplyCard(replyTo ?? "", signal),
    enabled: replyTo !== null,
    retry: false,
  });
  const replying = replyTo !== null && replyCard.data?.canReply === true;
  useEffect(() => {
    if (replyTo !== null && (replyCard.isError || (replyCard.data && !replyCard.data.canReply))) {
      message.info("That card can't be replied to any more.");
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("replyTo");
        return next;
      }, { replace: true });
    }
  }, [replyTo, replyCard.isError, replyCard.data, message, setParams]);
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

  const abroad = recipients.filter(isInternational).length;
  const international = designs.length * abroad;
  const domestic = designs.length * ((replying ? 1 : recipients.length) - abroad);
  const count = domestic + international;
  const totalCents = domestic * store.postcardPriceCents + international * (store.internationalPostcardPriceCents ?? 0);
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

  const removeDesign = (index: number) => {
    setDesigns((current) => current.filter((_, i) => i !== index));
    setEditingIndex((current) => (current === index ? null : current));
  };

  const startEdit = (index: number) => {
    setEditingIndex(index);
    document.getElementById("design-heading")?.scrollIntoView();
  };

  const editDesign = (design: PostcardDesign) => {
    setDesigns((current) => current.map((d, i) => (i === editingIndex ? design : d)));
    setEditingIndex(null);
  };

  const arriveBy = (designId: string, mailDate: string) => {
    if (mode === "cadence" && designs.length === 1) {
      setStartDate(mailDate);
      return;
    }
    changeMode("custom");
    setCustomDate(designId, mailDate);
  };

  const line = () => ({
    designs: scheduled.map(({ design, mailDate }) => ({ designId: design.id, mailDate })),
    recipients: replying ? [] : recipients,
    replyLink,
    replyTo: replying ? replyTo : null,
    replyToName: replying ? (replyCard.data?.senderName ?? null) : null,
  });

  const addToCart = () => {
    add(line());
    void navigate("/cart");
  };

  return (
    <PageWrapper width="wide">
      <h1>Make a postcard</h1>

      <section className={cx(styles.panel)} aria-labelledby="design-heading">
        <h2 id="design-heading">1. Create a postcard design</h2>
        <DesignForm
          onSaved={addDesign}
          replyLink={replyLink}
          editing={editingDesign}
          onEdited={editDesign}
          onCancelEdit={() => setEditingIndex(null)}
        />
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
          onRemove={removeDesign}
          onEdit={startEdit}
          locale={store.locale}
          replyLink={replyLink}
          onReplyLinkChange={setReplyLink}
        />
      </section>

      <section className={cx(styles.panel)} aria-labelledby="recipients-heading">
        <h2 id="recipients-heading">3. Postcard recipients</h2>
        {replying ? (
          <div className={cx(postcard.replyLock)} role="status">
            <strong>To {replyCard.data?.senderName ?? "the sender"}</strong>
            <span className={postcard.note}>
              This is a reply to their postcard. Their address is kept private and added when you check out.
            </span>
          </div>
        ) : (
          <Recipients recipients={recipients} onChange={setRecipients} onBlockedChange={setBlocked} />
        )}
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
            <span className={postcard.count}>{replying ? 1 : recipients.length}</span> recipient{(replying ? 1 : recipients.length) === 1 ? "" : "s"}
          </span>
          <span>×</span>
          <span>
            {international > 0 && store.internationalPostcardPriceCents !== null
              ? `${price(store.postcardPriceCents)} each (${price(store.internationalPostcardPriceCents)} abroad)`
              : `${price(store.postcardPriceCents)} each`}
          </span>
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
                complimentary.mutate(line())
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
