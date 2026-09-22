import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { App, Button, Checkbox, Input, Popconfirm, Skeleton, Tag } from "antd";
import type { Mailing } from "@shared/platform";
import { todayIso, type PostcardDesign } from "@shared/postcards";
import { DesignForm } from "@/components/postcard/DesignForm";
import { ProductImage } from "@/components/ui/ProductImage";
import { useCancelMailing, useDeleteDesign, useMailingPostcards, useQueueMailing, useStudioDesigns, useStudioMailings, useUpdateMailing, type StudioView } from "@/lib/platform";
import { useStore } from "@/lib/useStore";
import { customerStatusLabel, formatMailDate } from "@/lib/postcards";
import { cx } from "@/lib/cx";
import postcard from "@/components/postcard/Postcard.module.css";
import styles from "./Studio.module.css";

/**
 * The queue: make a card, put it on a month.
 *
 * Two lists. Designs are what has been made and not yet queued — the
 * drawer. Mailings are the schedule: one per calendar month, soonest first,
 * with what happened to the ones that went. A design is queued by picking a
 * date; the suggested one is the artist's send day in the first free month.
 */
export function StudioQueuePage() {
  const view = useOutletContext<StudioView>();
  const store = useStore();
  const designs = useStudioDesigns();
  const queue = useStudioMailings();
  const { message } = App.useApp();


  const queuedDesignIds = new Set((queue.data?.mailings ?? []).map((m) => m.design.id));
  const drawer = (designs.data ?? []).filter((design) => !queuedDesignIds.has(design.id));
  const mailings = [...(queue.data?.mailings ?? [])].sort((a, b) => (a.status === b.status ? a.mailDate.localeCompare(b.mailDate) : a.status === "queued" ? -1 : 1));

  return (
    <div>
      <section className={styles.panel} aria-labelledby="design-heading">
        <h2 id="design-heading">Make a postcard</h2>
        <DesignForm artistName={view.artist.name} onSaved={() => void message.success("Saved. Queue it below.")} />
      </section>

      {drawer.length > 0 ? (
        <section className={styles.panel} aria-labelledby="drawer-heading">
          <h2 id="drawer-heading">Made, not yet queued</h2>
          <ul className={postcard.designGrid}>
            {drawer.map((design) => (
              <DrawerCard key={design.id} design={design} suggestedDate={queue.data?.nextMailDate ?? todayIso()} locale={store.locale} />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="queue-heading">
        <h2 id="queue-heading">Your queue</h2>
        {queue.isPending ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : mailings.length === 0 ? (
          <p className={styles.empty}>Nothing queued. Make a postcard above, then pick the month it goes out.</p>
        ) : (
          <ul className={styles.queue}>
            {mailings.map((mailing) => (
              <QueueRow key={mailing.id} mailing={mailing} locale={store.locale} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DrawerCard({ design, suggestedDate, locale }: { design: PostcardDesign; suggestedDate: string; locale: string }) {
  const queueMailing = useQueueMailing();
  const remove = useDeleteDesign();
  const { message } = App.useApp();
  const [date, setDate] = useState(suggestedDate);
  const [title, setTitle] = useState("");
  const [inGallery, setInGallery] = useState(true);

  useEffect(() => setDate(suggestedDate), [suggestedDate]);

  return (
    <li className={postcard.designCard}>
      <ProductImage image={design.thumbnail} sizes="200px" decorative />
      <label className={styles.field}>
        <span className={styles.label}>Goes out on</span>
        <input type="date" className={styles.dateInput} min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Title for the gallery (optional)</span>
        <Input size="small" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <Checkbox checked={inGallery} onChange={(e) => setInGallery(e.target.checked)}>
        Show in the gallery once mailed
      </Checkbox>
      <Button
        type="primary"
        size="small"
        loading={queueMailing.isPending}
        onClick={() =>
          queueMailing.mutate(
            { designId: design.id, mailDate: date, title: title.trim() || null, inGallery },
            {
              onSuccess: () => void message.success(`Queued for ${formatMailDate(date, locale)}.`),
              onError: (error: unknown) => void message.error(error instanceof Error ? error.message : "Could not queue it."),
            },
          )
        }
      >
        Queue it
      </Button>
      <Popconfirm title="Delete this postcard?" onConfirm={() => remove.mutate(design.id, { onError: (error: unknown) => void message.error(error instanceof Error ? error.message : "Could not delete it.") })}>
        <Button size="small" type="text" danger loading={remove.isPending}>
          Delete
        </Button>
      </Popconfirm>
    </li>
  );
}

function QueueRow({ mailing, locale }: { mailing: Mailing; locale: string }) {
  const update = useUpdateMailing();
  const cancel = useCancelMailing();
  const { message } = App.useApp();
  const [date, setDate] = useState(mailing.mailDate);
  const [title, setTitle] = useState(mailing.title ?? "");
  const [open, setOpen] = useState(false);
  const cards = useMailingPostcards(open ? mailing.id : null);
  const dirty = date !== mailing.mailDate || title !== (mailing.title ?? "");
  const fail = (error: unknown) => void message.error(error instanceof Error ? error.message : "Could not save.");
  const queued = mailing.status === "queued";

  return (
    <li className={cx(styles.queueRow, !queued && styles.queueRowPast)}>
      <ProductImage image={mailing.design.thumbnail} sizes="144px" decorative />
      <div className={styles.queueBody}>
        <p className={styles.queueDate}>
          {formatMailDate(mailing.mailDate, locale)}{" "}
          <Tag color={queued ? "blue" : mailing.status === "mailed" ? "green" : "default"}>{queued ? "queued" : mailing.status}</Tag>
          {mailing.title ? <span> · {mailing.title}</span> : null}
        </p>
        {queued ? (
          <>
            <div className={styles.inline}>
              <label className={styles.field}>
                <span className={styles.label}>Move to</span>
                <input type="date" className={styles.dateInput} min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Title</span>
                <Input size="small" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
              </label>
            </div>
            <Checkbox checked={mailing.inGallery} onChange={(e) => update.mutate({ id: mailing.id, input: { mailDate: mailing.mailDate, title: mailing.title, inGallery: e.target.checked } }, { onError: fail })}>
              Show in the gallery once mailed
            </Checkbox>
          </>
        ) : (
          <>
            <p className={styles.note}>
              Went to {mailing.subscriberCount} subscriber{mailing.subscriberCount === 1 ? "" : "s"}: {mailing.postcards.sent} mailed
              {mailing.postcards.scheduled > 0 ? `, ${mailing.postcards.scheduled} at the printer` : ""}
              {mailing.postcards.error > 0 ? `, ${mailing.postcards.error} we're sorting out` : ""}
              {mailing.postcards.cancelled > 0 ? `, ${mailing.postcards.cancelled} withdrawn` : ""}.
            </p>
            <Checkbox checked={mailing.inGallery} onChange={(e) => update.mutate({ id: mailing.id, input: { mailDate: mailing.mailDate, title: mailing.title, inGallery: e.target.checked } }, { onError: fail })}>
              Show in the gallery
            </Checkbox>
            <p>
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setOpen((v) => !v)}>
                {open ? "Hide who got it" : "Who got it"}
              </Button>
            </p>
            {open ? (
              cards.isPending ? (
                <Skeleton active paragraph={{ rows: 2 }} />
              ) : (
                <ul className={styles.note} style={{ paddingLeft: "1.25rem" }}>
                  {(cards.data ?? []).map((card) => (
                    <li key={card.id}>
                      {card.recipient.name}, {card.recipient.city} — {customerStatusLabel(card.status)}
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </>
        )}
      </div>
      <div className={styles.queueActions}>
        {queued ? (
          <>
            <Button size="small" type="primary" disabled={!dirty} loading={update.isPending} onClick={() => update.mutate({ id: mailing.id, input: { mailDate: date, title: title.trim() || null, inGallery: mailing.inGallery } }, { onSuccess: () => void message.success("Saved."), onError: fail })}>
              Save
            </Button>
            <Popconfirm title="Take this card out of the queue?" description="The postcard itself is kept; you can queue it again." onConfirm={() => cancel.mutate(mailing.id, { onError: fail })}>
              <Button size="small" danger loading={cancel.isPending}>
                Unqueue
              </Button>
            </Popconfirm>
          </>
        ) : null}
      </div>
    </li>
  );
}
