import { useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { Alert, App, Button, Input, InputNumber, Radio, Upload } from "antd";
import { DeleteOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { artistProfileInputSchema, DEFAULT_TERM_MONTHS, MAX_ARTIST_LINKS, type ArtistLink, type ArtistProfileInput, type ArtistVisibility } from "@shared/platform";
import { formatMoney, parseCents } from "@shared/money";
import type { Image } from "@shared/schema";
import { artistShareCents } from "@shared/schema";
import { useCreateArtist, useSlugAvailable, useUpdateProfile, useUploadAvatar, useUploadBanner, type StudioView } from "@/lib/platform";
import { useStore } from "@/lib/useStore";
import { useCustomer } from "@/lib/account";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import styles from "./Studio.module.css";

interface Draft {
  slug: string;
  name: string;
  tagline: string;
  bio: string;
  price: string;
  termMonths: number;
  sendDay: number;
  visibility: ArtistVisibility;
  avatar: Image | null;
  banner: Image | null;
  links: ArtistLink[];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * The page's own form: address, name, a line, the story, the price, the
 * term, the day, and where else to find them.
 *
 * Shared by "open a studio" (create) and "your page" (edit): the fields are
 * the same, the only difference is which route gets the result. The price
 * floor and the resulting share are read from the platform's pricing so the
 * artist sees what a card earns before they set anything.
 */
function ProfileForm({ initial, mode }: { initial: Draft; mode: "create" | "edit" }) {
  const store = useStore();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const create = useCreateArtist();
  const update = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  const uploadBanner = useUploadBanner();
  const [draft, setDraft] = useState<Draft>(initial);
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [error, setError] = useState<string | null>(null);
  const pending = mode === "create" ? create : update;

  const slugCheck = useSlugAvailable(draft.slug, draft.slug !== initial.slug || mode === "create");
  const priceCents = parseCents(draft.price);
  const floor = store.pricing.minMonthlyPriceCents;
  const priceWrong = priceCents === null || priceCents < floor;
  const share = priceCents === null ? null : artistShareCents(priceCents, store.pricing);
  const money = (cents: number) => formatMoney(cents, store.currency, store.locale);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const setLink = (index: number, patch: Partial<ArtistLink>) =>
    setDraft((current) => ({ ...current, links: current.links.map((link, i) => (i === index ? { ...link, ...patch } : link)) }));
  const removeLink = (index: number) => setDraft((current) => ({ ...current, links: current.links.filter((_, i) => i !== index) }));
  const addLink = () => setDraft((current) => ({ ...current, links: [...current.links, { label: "", url: "" }] }));

  const submit = () => {
    if (priceCents === null) return;
    const parsed = artistProfileInputSchema.safeParse({
      slug: draft.slug,
      name: draft.name,
      tagline: draft.tagline.trim() || null,
      bio: draft.bio,
      monthlyPriceCents: priceCents,
      termMonths: draft.termMonths,
      sendDay: draft.sendDay,
      visibility: draft.visibility,
      avatar: draft.avatar,
      banner: draft.banner,
      // A row with nothing typed in it is not a link; one with a label and no address is a mistake the schema names.
      links: draft.links.filter((link) => link.url.trim() !== "" || link.label.trim() !== ""),
    } satisfies Record<keyof ArtistProfileInput, unknown>);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setError(null);
    pending.mutate(parsed.data, {
      onSuccess: () => {
        message.success(mode === "create" ? "Your studio is open." : "Saved.");
        void navigate("/studio");
      },
      onError: (err: unknown) => setError(err instanceof Error ? err.message : "Could not save."),
    });
  };

  return (
    <div className={styles.form}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="artist-name">
          Your name, as it prints on the card
        </label>
        <Input
          id="artist-name"
          value={draft.name}
          maxLength={80}
          onChange={(e) => {
            set("name", e.target.value);
            if (!slugTouched) set("slug", slugify(e.target.value));
          }}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="artist-slug">
          Your address
        </label>
        <Input
          id="artist-slug"
          prefix={<span className={styles.slugPreview}>{`${window.location.host}/artist/`}</span>}
          value={draft.slug}
          maxLength={40}
          onChange={(e) => {
            setSlugTouched(true);
            set("slug", slugify(e.target.value));
          }}
        />
        <span className={styles.help}>
          {draft.slug.length < 3 ? "At least 3 characters: letters, numbers and hyphens." : slugCheck.data?.available === false ? <span className={styles.error}>That address is taken.</span> : slugCheck.data?.available ? "Available." : "Lowercase letters, numbers and hyphens."}
          {mode === "edit" ? " Changing it breaks links people have shared." : ""}
        </span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="artist-tagline">
          One line about what you send (optional)
        </label>
        <Input id="artist-tagline" value={draft.tagline} maxLength={140} placeholder="photos from the road, and what I was thinking" onChange={(e) => set("tagline", e.target.value)} />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="artist-bio">
          Your page
        </label>
        <Input.TextArea id="artist-bio" value={draft.bio} autoSize={{ minRows: 6 }} maxLength={10_000} placeholder="Who you are, what the postcards will be, why. Markdown works." onChange={(e) => set("bio", e.target.value)} />
        <span className={styles.help}>Markdown: **bold**, _italics_, links, headings. Rendered on your page under your name.</span>
      </div>

      <div className={styles.inline}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="artist-price">
            Monthly price
          </label>
          <Input id="artist-price" style={{ width: "10rem" }} prefix={store.currency === "USD" ? "$" : store.currency} inputMode="decimal" value={draft.price} status={priceWrong ? "error" : ""} onChange={(e) => set("price", e.target.value)} />
          <span className={priceWrong ? styles.error : styles.help}>
            {priceWrong ? `At least ${money(floor)}: below that a card costs more to send than it brings in.` : share !== null ? `Each card mailed earns you ${money(share)} per subscriber, after ${money(store.pricing.printCostCents)} printing and a ${money(store.pricing.platformFeeCents)} fee.` : ""}
          </span>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="artist-term">
            Subscription length, in months
          </label>
          <InputNumber id="artist-term" min={1} max={24} value={draft.termMonths} onChange={(value) => set("termMonths", value ?? DEFAULT_TERM_MONTHS)} />
          <span className={styles.help}>
            Subscribers pay month by month and stop after {draft.termMonths} {draft.termMonths === 1 ? "card" : "cards"}. Nobody is billed forever; they can subscribe again.
          </span>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="artist-day">
            Day of the month cards go out
          </label>
          <InputNumber id="artist-day" min={1} max={28} value={draft.sendDay} onChange={(value) => set("sendDay", value ?? 15)} />
          <span className={styles.help}>The default for each card you queue. 28 at most, so February works.</span>
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label} id="artist-visibility-label">
          Gallery
        </span>
        <Radio.Group
          aria-labelledby="artist-visibility-label"
          value={draft.visibility}
          onChange={(e) => set("visibility", e.target.value as ArtistVisibility)}
          options={[
            { value: "public", label: "Public" },
            { value: "private", label: "Private" },
          ]}
        />
        <span className={styles.help}>
          {draft.visibility === "public"
            ? "Cards you mail can appear in the site's gallery of recent postcards, with your name on them."
            : "Your cards stay between you and your subscribers: they show on your own page, but never in the site's gallery."}
        </span>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Photo of you (optional)</span>
        <div className={styles.avatarRow}>
          {draft.avatar ? <img className={styles.avatarPreview} src={assetUrl(draft.avatar.path)} alt="" /> : <div className={styles.avatarPreview} aria-hidden />}
          <Upload
            accept="image/*"
            showUploadList={false}
            beforeUpload={(file) => {
              uploadAvatar.mutate({ file, alt: draft.name }, { onSuccess: (image) => set("avatar", image), onError: () => void message.error("That image could not be uploaded.") });
              return Upload.LIST_IGNORE;
            }}
          >
            <Button icon={<UploadOutlined />} loading={uploadAvatar.isPending}>
              {draft.avatar ? "Replace" : "Upload"}
            </Button>
          </Upload>
          {draft.avatar ? (
            <Button type="link" size="small" onClick={() => set("avatar", null)}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Banner across the top of your page (optional)</span>
        {draft.banner ? <img className={styles.bannerPreview} src={assetUrl(draft.banner.path)} alt="" /> : <div className={cx(styles.bannerPreview, styles.bannerEmpty)} aria-hidden />}
        <div className={styles.avatarRow}>
          <Upload
            accept="image/*"
            showUploadList={false}
            beforeUpload={(file) => {
              uploadBanner.mutate({ file, alt: "" }, { onSuccess: (image) => set("banner", image), onError: () => void message.error("That image could not be uploaded.") });
              return Upload.LIST_IGNORE;
            }}
          >
            <Button icon={<UploadOutlined />} loading={uploadBanner.isPending}>
              {draft.banner ? "Replace" : "Upload"}
            </Button>
          </Upload>
          {draft.banner ? (
            <Button type="link" size="small" onClick={() => set("banner", null)}>
              Remove
            </Button>
          ) : null}
          <span className={styles.help}>Wide works best: it is shown about three times as wide as it is tall.</span>
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Where else to find you (optional)</span>
        {draft.links.length > 0 ? (
          <ul className={styles.linkList}>
            {draft.links.map((link, index) => (
              <li key={index} className={styles.linkRow}>
                <Input aria-label={`Link ${index + 1} label`} placeholder="Instagram, website, shop…" maxLength={40} value={link.label} onChange={(e) => setLink(index, { label: e.target.value })} className={styles.linkLabel} />
                <Input aria-label={`Link ${index + 1} address`} placeholder="https://" inputMode="url" maxLength={500} value={link.url} onChange={(e) => setLink(index, { url: e.target.value })} />
                <Button aria-label={`Remove link ${index + 1}`} icon={<DeleteOutlined />} onClick={() => removeLink(index)} />
              </li>
            ))}
          </ul>
        ) : null}
        <div>
          <Button icon={<PlusOutlined />} disabled={draft.links.length >= MAX_ARTIST_LINKS} onClick={addLink}>
            Add a link
          </Button>
        </div>
        <span className={styles.help}>Your website, your shop, your accounts. Full addresses, starting with https://. A blank label shows the site's name.</span>
      </div>

      {error ? <Alert type="error" showIcon title={error} /> : null}

      <div className={styles.actions}>
        <Button type="primary" size="large" loading={pending.isPending} disabled={priceWrong || draft.name.trim() === "" || draft.slug.length < 3} onClick={submit}>
          {mode === "create" ? "Open your studio" : "Save"}
        </Button>
        {mode === "edit" ? (
          <Link to="/studio">
            <Button size="large">Cancel</Button>
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** "Open a studio": the form, with a word about what it means first. */
export function StudioNewPage() {
  const store = useStore();
  const customer = useCustomer();

  return (
    <div>
      <h1>Open a studio</h1>
      <p style={{ maxWidth: "40rem" }}>
        You get a page at your own address. People subscribe for a monthly price you set, for a fixed number of months. Once a month you queue a postcard — a photo
        you took and a note — and we print it and mail it to every one of them. After printing and a small fee, the rest is yours.
      </p>
      <p style={{ maxWidth: "40rem" }}>Your page starts as a draft. Nobody sees it until you go live.</p>
      <ProfileForm
        mode="create"
        initial={{
          slug: slugify(customer.data?.name ?? ""),
          name: customer.data?.name ?? "",
          tagline: "",
          bio: "",
          price: (Math.max(store.pricing.minMonthlyPriceCents, 500) / 100).toFixed(2),
          termMonths: DEFAULT_TERM_MONTHS,
          sendDay: 15,
          visibility: "public",
          avatar: null,
          banner: null,
          links: [],
        }}
      />
    </div>
  );
}

/** "Your page": the same form, filled in. */
export function StudioProfilePage() {
  const view = useOutletContext<StudioView>();
  const { artist } = view;

  return (
    <div>
      <h2>Your page</h2>
      <ProfileForm
        mode="edit"
        initial={{
          slug: artist.slug,
          name: artist.name,
          tagline: artist.tagline ?? "",
          bio: artist.bio,
          price: (artist.monthlyPriceCents / 100).toFixed(2),
          termMonths: artist.termMonths,
          sendDay: artist.sendDay,
          visibility: artist.visibility,
          avatar: artist.avatar,
          banner: artist.banner,
          links: artist.links,
        }}
      />
      <p className={cx(styles.note)} style={{ marginTop: "1.5rem" }}>
        Changing your price or subscription length affects new subscribers only. Everyone already subscribed keeps the price and the number of months they signed up for.
      </p>
    </div>
  );
}
