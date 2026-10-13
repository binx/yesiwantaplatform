import { useEffect, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { Alert, App, Button, Checkbox, Input, Popconfirm, Radio, Skeleton, Upload } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, UploadOutlined } from "@ant-design/icons";
import { EDITION_SIZES, editionInputSchema, editionPath, type ArtistStudio, type EditionInput, type EditionSize, type EditionStudio } from "@shared/platform";
import type { PostcardDesign } from "@shared/postcards";
import { formatMoney, parseCents } from "@shared/money";
import { KEEPS_EVERY_CARD } from "@shared/copy";
import { artistShareCents, cardGrossCents, type Image } from "@shared/schema";
import { ApiError } from "@/lib/api";
import { ProductImage } from "@/components/ui/ProductImage";
import { useCreateEdition, useDeleteEdition, useSetEditionCards, useSetEditionStatus, useStudioEdition, useUpdateEdition, useUploadEditionBanner, type StudioView } from "@/lib/platform";
import { useStore } from "@/lib/useStore";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import { DesignPicker } from "./StudioDesigns";
import { EditionStatusTag } from "./StudioEditionsPage";
import styles from "./Studio.module.css";

interface Draft {
  slug: string;
  title: string;
  description: string;
  banner: Image | null;
  cardCount: EditionSize;
  price: string;
  inGallery: boolean;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const fail = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/**
 * An edition's own form: its words, its banner, its shape and its price.
 *
 * Shared by "new edition" and the editor. Once an edition is on sale its
 * address, size and price are what collectors paid for, so those
 * fields are disabled — the server refuses a change to them anyway — and
 * only the words and the banner stay open. The cards are a surprise: a
 * visitor sees the banner and the writeup, never the cards themselves. What each card earns is worked out here with
 * the same two functions the ledger uses, so the number the artist sees
 * while typing is the number they will be paid.
 */
function EditionForm({ initial, edition }: { initial: Draft; edition: EditionStudio | null }) {
  const view = useOutletContext<StudioView>();
  const store = useStore();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const create = useCreateEdition();
  const update = useUpdateEdition();
  const uploadBanner = useUploadEditionBanner();
  const [draft, setDraft] = useState<Draft>(initial);
  const [slugTouched, setSlugTouched] = useState(edition !== null);
  const [error, setError] = useState<string | null>(null);
  const pending = edition ? update : create;
  const fixed = edition !== null && edition.status !== "draft";
  /** Under review, nothing changes: the admin is looking at it as it is. */
  const locked = edition !== null && edition.status === "in_review";

  const pricing = view.pricing ?? store.pricing;
  const currency = edition?.currency ?? store.currency;
  const money = (cents: number) => formatMoney(cents, currency, store.locale);
  const priceCents = parseCents(draft.price);
  const floor = Math.max(pricing.minCardPriceCents * draft.cardCount, 50);
  const priceWrong = priceCents === null || priceCents < floor;
  // Card 1 carries the cents that don't divide; every other card is the even split.
  const share = priceCents === null ? null : artistShareCents(cardGrossCents(priceCents, draft.cardCount, 2), pricing);
  const dropped = edition && !fixed ? edition.cards.length - draft.cardCount : 0;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = () => {
    if (priceCents === null) return;
    const parsed = editionInputSchema.safeParse({
      slug: draft.slug,
      title: draft.title,
      description: draft.description,
      banner: draft.banner,
      cardCount: draft.cardCount,
      priceCents,
      inGallery: draft.inGallery,
    } satisfies Record<keyof EditionInput, unknown>);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setError(null);
    if (edition) {
      update.mutate({ id: edition.id, input: parsed.data }, { onSuccess: () => void message.success("Saved."), onError: (err: unknown) => setError(fail(err, "Could not save.")) });
    } else {
      create.mutate(parsed.data, {
        onSuccess: (created) => {
          message.success("Edition started. Now choose its cards.");
          void navigate(`/studio/editions/${created.id}`);
        },
        onError: (err: unknown) => setError(fail(err, "Could not save.")),
      });
    }
  };

  return (
    <div className={styles.form}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="edition-title">
          Title
        </label>
        <Input
          id="edition-title"
          value={draft.title}
          maxLength={80}
          placeholder="Flowers"
          disabled={locked}
          onChange={(e) => {
            set("title", e.target.value);
            if (!slugTouched) set("slug", slugify(e.target.value));
          }}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="edition-slug">
          Edition URL
        </label>
        <Input
          id="edition-slug"
          prefix={<span className={styles.slugPreview}>{`${window.location.host}${editionPath(view.artist.slug, "")}`}</span>}
          value={draft.slug}
          maxLength={60}
          disabled={fixed}
          aria-describedby="edition-slug-help"
          onChange={(e) => {
            setSlugTouched(true);
            set("slug", slugify(e.target.value));
          }}
        />
        <span className={styles.help} id="edition-slug-help">
          {locked ? "Fixed while it's being reviewed." : fixed ? "Fixed while it's on sale, so links people have shared keep working." : "Lowercase letters, numbers and hyphens."}
        </span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="edition-description">
          What collectors will get
        </label>
        <Input.TextArea
          id="edition-description"
          value={draft.description}
          autoSize={{ minRows: 5 }}
          maxLength={10_000}
          placeholder="What the cards are of, where they come from, why these. Markdown works."
          disabled={locked}
          onChange={(e) => set("description", e.target.value)}
        />
        <span className={styles.help}>
          This is how collectors decide: tell them what's coming. Markdown: **bold**, _italics_, links.
        </span>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Banner</span>
        {draft.banner ? <img className={styles.bannerPreview} src={assetUrl(draft.banner.path)} alt="" /> : <div className={cx(styles.bannerPreview, styles.bannerEmpty)} aria-hidden />}
        <div className={styles.avatarRow}>
          <Upload
            accept="image/*"
            showUploadList={false}
            beforeUpload={(file) => {
              uploadBanner.mutate({ file, alt: draft.title }, { onSuccess: (image) => set("banner", image), onError: () => void message.error("That image could not be uploaded.") });
              return Upload.LIST_IGNORE;
            }}
          >
            <Button icon={<UploadOutlined />} loading={uploadBanner.isPending} disabled={locked}>
              {draft.banner ? "Replace banner" : "Upload a banner"}
            </Button>
          </Upload>
          {draft.banner && !locked ? (
            <Button type="link" size="small" onClick={() => set("banner", null)}>
              Remove
            </Button>
          ) : null}
        </div>
        <span className={styles.help}>Across the top of the edition's page. Wide works best, about three times as wide as it is tall. Needed to put it on sale.</span>
      </div>

      <div className={styles.inline}>
        <div className={styles.field}>
          <span className={styles.label} id="edition-size-label">
            How many cards
          </span>
          <Radio.Group
            aria-labelledby="edition-size-label"
            value={draft.cardCount}
            disabled={fixed}
            onChange={(e) => set("cardCount", e.target.value as EditionSize)}
            options={EDITION_SIZES.map((size) => ({ value: size, label: String(size) }))}
          />
        </div>
      </div>
      <span className={styles.help}>
        {locked
          ? "Fixed while it's being reviewed."
          : fixed
            ? "Size and price are fixed while it's on sale: collectors paid for exactly this."
            : `Each collector gets ${draft.cardCount} postcards, at the pace they choose, starting on a day they pick.`}
      </span>
      {dropped > 0 ? <Alert type="warning" showIcon title={`Saving drops the last ${dropped} ${dropped === 1 ? "card" : "cards"} you chose: an edition of ${draft.cardCount} holds ${draft.cardCount}.`} /> : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="edition-price">
          Price for the whole edition
        </label>
        <Input
          id="edition-price"
          style={{ width: "10rem" }}
          prefix={currency === "USD" ? "$" : currency}
          inputMode="decimal"
          value={draft.price}
          disabled={fixed}
          status={!fixed && priceWrong ? "error" : ""}
          aria-describedby="edition-price-help"
          onChange={(e) => set("price", e.target.value)}
        />
        <span className={!fixed && priceWrong ? styles.error : styles.help} id="edition-price-help">
          {!fixed && priceWrong
            ? `At least ${money(floor)} for an edition of ${draft.cardCount}: below that a card costs more to send than it brings in.`
            : share !== null
              ? `Each card earns you ${money(share)} as it's mailed, after ${money(pricing.printCostCents)} for printing and postage and a ${pricing.platformFeePercent}% fee. At least ${money(floor)} for an edition of ${draft.cardCount}.`
              : ""}
        </span>
      </div>

      <Checkbox checked={draft.inGallery} disabled={locked} onChange={(e) => set("inGallery", e.target.checked)}>
        Show this edition in the gallery while it's on sale
      </Checkbox>
      {view.artist.visibility === "private" ? <span className={styles.help}>Your page is private, so none of your editions go in the gallery whatever this says.</span> : null}


      {error ? <Alert type="error" showIcon title={error} /> : null}

      <div className={styles.actions}>
        <Button type="primary" size="large" loading={pending.isPending} disabled={locked || (!fixed && priceWrong) || draft.title.trim() === "" || draft.slug === ""} onClick={submit}>
          {edition ? "Save" : "Start this edition"}
        </Button>
        <Link to="/studio/editions">
          <Button size="large">{edition ? "Back to editions" : "Cancel"}</Button>
        </Link>
      </div>
    </div>
  );
}

/** "New edition": the form, with a word about what comes next. */
export function StudioNewEditionPage() {
  const view = useOutletContext<StudioView>();
  const store = useStore();
  const pricing = view.pricing ?? store.pricing;

  return (
    <div>
      <h2>New edition</h2>
      <p className={styles.note} style={{ maxWidth: "40rem", marginBottom: "1.5rem" }}>
        An edition is a set of postcards collectors buy once, for one price, and receive one by one. It starts as a draft only you can see: give it a name, a price
        and a banner, choose its cards, then send it for review. Once it's approved it's on sale. Collectors see the banner and what you write, not the cards: those arrive as a surprise.
      </p>
      <EditionForm
        edition={null}
        initial={{
          slug: "",
          title: "",
          description: "",
          banner: null,
          cardCount: 6,
          price: (Math.max(pricing.minCardPriceCents * 6, 3000) / 100).toFixed(2),
          inGallery: true,
        }}
      />
    </div>
  );
}

/** One edition: where it is, its cards, and its details. */
export function StudioEditionPage() {
  const { id } = useParams();
  const view = useOutletContext<StudioView>();
  const edition = useStudioEdition(id);
  const [cardsDirty, setCardsDirty] = useState(false);

  if (edition.isPending) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (edition.isError) {
    return (
      <div>
        <Alert type="error" showIcon title={edition.error instanceof ApiError && edition.error.status === 404 ? "No edition found." : "This edition could not be loaded."} />
        <p style={{ marginTop: "1rem" }}>
          <Link to="/studio/editions">Back to your editions</Link>
        </p>
      </div>
    );
  }

  const data = edition.data;

  return (
    <div>
      <p className={styles.note} style={{ marginBottom: "0.5rem" }}>
        <Link to="/studio/editions">Editions</Link>
      </p>
      <h2 className={styles.editionHeading}>
        {data.title} <EditionStatusTag status={data.status} />
      </h2>

      <StatusPanel edition={data} artist={view.artist} cardsDirty={cardsDirty} />

      <section aria-labelledby="cards-heading" style={{ marginBottom: "2rem" }}>
        <h2 id="cards-heading">The cards</h2>
        <EditionCards key={`${data.id}:${data.status}:${cardsKey(data)}`} edition={data} artistName={view.artist.name} onDirtyChange={setCardsDirty} />
      </section>

      <section aria-labelledby="details-heading">
        <h2 id="details-heading">Details</h2>
        <EditionForm
          key={`${data.id}:${data.status}`}
          edition={data}
          initial={{
            slug: data.slug,
            title: data.title,
            description: data.description,
            banner: data.banner,
            cardCount: data.cardCount,
            price: (data.priceCents / 100).toFixed(2),
            inGallery: data.inGallery,
          }}
        />
      </section>
    </div>
  );
}

/** What the server has, as a string: when it changes, the card editor starts again from it. */
function cardsKey(edition: EditionStudio): string {
  return edition.cards.map((card) => `${card.design.id}=${card.title ?? ""}`).join("|");
}

/**
 * Where the edition is in its life, and the one or two ways it can move.
 *
 * Sending it for review needs every card saved in place and a banner; the
 * admin is who puts it on sale. Going back to draft is refused by the
 * server once anyone has bought it, and that refusal is shown as it comes.
 */
function StatusPanel({ edition, artist, cardsDirty }: { edition: EditionStudio; artist: ArtistStudio; cardsDirty: boolean }) {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const setStatus = useSetEditionStatus();
  const remove = useDeleteEdition();
  const [error, setError] = useState<string | null>(null);
  const missing = edition.cardCount - edition.cards.length;
  const needs = [
    missing > 0 ? `choose ${missing} more ${missing === 1 ? "card" : "cards"}` : null,
    edition.banner ? null : "add a banner",
    cardsDirty ? "save your cards" : null,
  ].filter((need): need is string => need !== null);
  const publicPath = editionPath(artist.slug, edition.slug);

  const move = (status: EditionStudio["status"], done: string) => {
    setError(null);
    setStatus.mutate({ id: edition.id, status }, { onSuccess: () => void message.success(done), onError: (err: unknown) => setError(fail(err, "Could not change that.")) });
  };

  return (
    <div className={cx(styles.panel, styles.panelAccent)}>
      {edition.status === "draft" ? (
        <>
          {edition.reviewNote ? <Alert type="warning" showIcon title="Not approved" description={<span style={{ whiteSpace: "pre-wrap" }}>{edition.reviewNote}</span>} style={{ marginBottom: "1rem" }} /> : null}
          <p className={styles.note}>
            {needs.length > 0
              ? `A draft: only you can see it. To send it for review, ${needs.length === 1 ? needs[0] : `${needs.slice(0, -1).join(", ")} and ${needs.at(-1)}`}.`
              : "Ready to send for review. Once it's approved it's on sale, and its cards, size and price are fixed."}
          </p>
          <div className={styles.actions}>
            <Button type="primary" loading={setStatus.isPending} disabled={needs.length > 0} onClick={() => move("in_review", "Sent for review.")}>
              {edition.reviewNote ? "Send for review again" : "Send for review"}
            </Button>
            <Popconfirm
              title="Delete this draft?"
              description="The postcards in it stay in your drawer."
              okText="Delete"
              onConfirm={() =>
                remove.mutate(edition.id, {
                  onSuccess: () => {
                    message.success("Draft deleted.");
                    void navigate("/studio/editions");
                  },
                  onError: (err: unknown) => setError(fail(err, "Could not delete it.")),
                })
              }
            >
              <Button danger loading={remove.isPending}>
                Delete draft
              </Button>
            </Popconfirm>
          </div>
        </>
      ) : edition.status === "in_review" ? (
        <>
          <p className={styles.note}>Being reviewed. It goes on sale once it's approved, and you'll get an email either way.</p>
          <div className={styles.actions}>
            <Button loading={setStatus.isPending} onClick={() => move("draft", "Back to a draft.")}>
              Back to draft
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.note}>
            {edition.status === "on_sale" ? "On sale" : "Closed to new collectors"}: {edition.collectorCount} {edition.collectorCount === 1 ? "collector" : "collectors"},{" "}
            {edition.sentCount} {edition.sentCount === 1 ? "card" : "cards"} sent, {edition.scheduledCount} to come.
            {edition.status === "closed" ? ` ${KEEPS_EVERY_CARD}` : ""}
          </p>
          <p className={styles.note}>
            {artist.status === "live" ? (
              <a href={publicPath} target="_blank" rel="noreferrer">
                {publicPath}
              </a>
            ) : (
              <span>{publicPath} — public once your page is live</span>
            )}
          </p>
          <div className={styles.actions}>
            {edition.status === "on_sale" ? (
              <Popconfirm
                title="Close to new collectors?"
                description={`Nobody new can collect it. ${KEEPS_EVERY_CARD}`}
                okText="Close"
                onConfirm={() => move("closed", "Closed to new collectors.")}
              >
                <Button loading={setStatus.isPending}>Close to new collectors</Button>
              </Popconfirm>
            ) : (
              <Button type="primary" loading={setStatus.isPending} onClick={() => move("on_sale", "On sale again.")}>
                Reopen
              </Button>
            )}
            <Button loading={setStatus.isPending} onClick={() => move("draft", "Back to a draft.")}>
              Back to draft
            </Button>
          </div>
        </>
      )}
      {error ? <Alert type="error" showIcon title={error} style={{ marginTop: "1rem" }} /> : null}
    </div>
  );
}

interface CardDraft {
  design: PostcardDesign;
  title: string;
}

/**
 * The cards, in the order they are mailed. Only the artist sees them here:
 * collectors meet each one when it arrives.
 *
 * Changes are kept here until Save, which sends the whole list — the
 * server replaces the set rather than patching it. Positions are always
 * 1 to n with no gaps, so an empty slot is filled from the first one.
 */
function EditionCards({ edition, artistName, onDirtyChange }: { edition: EditionStudio; artistName: string; onDirtyChange: (dirty: boolean) => void }) {
  const { message } = App.useApp();
  const save = useSetEditionCards();
  const initial = edition.cards.map((card) => ({ design: card.design, title: card.title ?? "" }));
  const [cards, setCards] = useState<CardDraft[]>(initial);
  /** The index being chosen for: an existing card's to replace it, or `cards.length` to add one. */
  const [picking, setPicking] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ designId: string; direction: "earlier" | "later" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = edition.status === "draft";
  const dirty = JSON.stringify(cards.map((card) => [card.design.id, card.title.trim()])) !== JSON.stringify(initial.map((card) => [card.design.id, card.title.trim()]));

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  // After a move, keep focus on the card that moved; at an end, on its other button.
  useEffect(() => {
    if (!focus) return;
    const other = focus.direction === "earlier" ? "later" : "earlier";
    const button = document.getElementById(`move-${focus.direction}-${focus.designId}`) as HTMLButtonElement | null;
    const fallback = document.getElementById(`move-${other}-${focus.designId}`) as HTMLButtonElement | null;
    (button && !button.disabled ? button : fallback)?.focus();
    setFocus(null);
  }, [focus]);

  const moveCard = (index: number, by: -1 | 1) => {
    const target = index + by;
    setCards((current) => {
      const next = [...current];
      const [card] = next.splice(index, 1);
      if (card) next.splice(target, 0, card);
      return next;
    });
    const designId = cards[index]?.design.id;
    if (designId) setFocus({ designId, direction: by < 0 ? "earlier" : "later" });
  };
  const removeCard = (index: number) => setCards((current) => current.filter((_, i) => i !== index));
  const setTitle = (index: number, title: string) => setCards((current) => current.map((card, i) => (i === index ? { ...card, title } : card)));
  const pick = (design: PostcardDesign) => {
    setCards((current) => (picking !== null && picking < current.length ? current.map((card, i) => (i === picking ? { design, title: card.title } : card)) : [...current, { design, title: "" }]));
    setPicking(null);
  };

  const submit = () => {
    setError(null);
    save.mutate(
      { id: edition.id, input: { cards: cards.map((card) => ({ designId: card.design.id, title: card.title.trim() || null })) } },
      { onSuccess: () => void message.success("Cards saved."), onError: (err: unknown) => setError(fail(err, "Could not save the cards.")) },
    );
  };

  const exclude = new Set(cards.filter((_, i) => i !== picking).map((card) => card.design.id));
  const empties = Array.from({ length: Math.max(0, edition.cardCount - cards.length) }, (_, i) => cards.length + i);

  return (
    <div>
      <p className={styles.note} style={{ marginBottom: "1rem" }}>
        In the order they're mailed. Collectors won't see them before they arrive.
        {editable ? "" : edition.status === "in_review" ? " Fixed while it's being reviewed." : " Fixed while it's on sale."}
      </p>
      <ol className={styles.slotList}>
        {cards.map((card, index) => {
          const n = index + 1;
          return (
            <li key={card.design.id} className={cx(styles.slot, picking === index && styles.slotPicking)}>
              <span className={styles.slotNumber} aria-hidden>
                {n}
              </span>
              <ProductImage image={card.design.thumbnail} sizes="144px" decorative />
              <div className={styles.slotBody}>
                <p className={styles.slotLabel}>Card {n}</p>
                {editable ? (
                  <label className={styles.field}>
                    <span className={styles.label}>Title (optional)</span>
                    <Input size="small" value={card.title} maxLength={120} onChange={(e) => setTitle(index, e.target.value)} aria-label={`Card ${n} title (optional)`} />
                  </label>
                ) : card.title ? (
                  <p className={styles.note}>{card.title}</p>
                ) : null}
              </div>
              {editable ? (
                <div className={styles.slotActions}>
                  <Button id={`move-earlier-${card.design.id}`} size="small" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => moveCard(index, -1)} aria-label={`Move card ${n} earlier`} />
                  <Button
                    id={`move-later-${card.design.id}`}
                    size="small"
                    icon={<ArrowDownOutlined />}
                    disabled={index === cards.length - 1}
                    onClick={() => moveCard(index, 1)}
                    aria-label={`Move card ${n} later`}
                  />
                  <Button size="small" onClick={() => setPicking(index)} aria-label={`Replace card ${n}`}>
                    Replace
                  </Button>
                  <Button size="small" type="text" danger onClick={() => removeCard(index)} aria-label={`Remove card ${n}`}>
                    Remove
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
        {editable
          ? empties.map((index) => (
              <li key={`empty-${index}`} className={cx(styles.slot, styles.slotEmpty, picking === index && styles.slotPicking)}>
                <span className={styles.slotNumber} aria-hidden>
                  {index + 1}
                </span>
                <div className={styles.slotImageEmpty} aria-hidden />
                <div className={styles.slotBody}>
                  <p className={styles.slotLabel}>Card {index + 1}</p>
                  {index === cards.length ? (
                    <Button size="small" type="primary" onClick={() => setPicking(index)}>
                      Choose card {index + 1}
                    </Button>
                  ) : (
                    <p className={styles.help}>Empty</p>
                  )}
                </div>
              </li>
            ))
          : null}
      </ol>

      {picking !== null ? (
        <DesignPicker
          heading={picking < cards.length ? `Replace card ${picking + 1}` : `Choose card ${picking + 1}`}
          artistName={artistName}
          exclude={exclude}
          onPick={pick}
          onCancel={() => setPicking(null)}
        />
      ) : null}

      {editable ? (
        <>
          {error ? <Alert type="error" showIcon title={error} style={{ marginTop: "1rem" }} /> : null}
          <div className={styles.actions}>
            <Button type="primary" disabled={!dirty} loading={save.isPending} onClick={submit}>
              Save cards
            </Button>
            {dirty ? (
              <Button onClick={() => setCards(initial)}>Undo changes</Button>
            ) : null}
            <span className={styles.note} role="status">
              {dirty ? "Unsaved changes." : `${cards.length} of ${edition.cardCount} chosen.`}
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}
