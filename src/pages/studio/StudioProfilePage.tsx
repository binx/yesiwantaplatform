import { useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { Alert, App, Button, Input, Radio, Upload } from "antd";
import { DeleteOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { artistProfileInputSchema, MAX_ARTIST_LINKS, type ArtistLink, type ArtistProfileInput, type ArtistVisibility } from "@shared/platform";
import type { Image } from "@shared/schema";
import { useCreateArtist, useSlugAvailable, useUpdateProfile, useUploadAvatar, useUploadBanner, type StudioView } from "@/lib/platform";
import { useCustomer } from "@/lib/account";
import { useStore } from "@/lib/useStore";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import styles from "./Studio.module.css";

interface Draft {
  slug: string;
  name: string;
  bio: string;
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
 * The page's own form: URL, name, the story, the pictures (the banner is
 * not optional: a page always has one), and where else to find them. Prices live on editions, not here.
 *
 * Shared by "open a studio" (create) and "your profile" (edit): the fields
 * are the same, the only difference is which route gets the result.
 */
function ProfileForm({ initial, mode }: { initial: Draft; mode: "create" | "edit" }) {
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

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const setLink = (index: number, patch: Partial<ArtistLink>) =>
    setDraft((current) => ({ ...current, links: current.links.map((link, i) => (i === index ? { ...link, ...patch } : link)) }));
  const removeLink = (index: number) => setDraft((current) => ({ ...current, links: current.links.filter((_, i) => i !== index) }));
  const addLink = () => setDraft((current) => ({ ...current, links: [...current.links, { label: "", url: "" }] }));

  const submit = () => {
    const parsed = artistProfileInputSchema.safeParse({
      slug: draft.slug,
      name: draft.name,
      bio: draft.bio,
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
          Your studio URL
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
          {draft.slug.length < 3 ? "At least 3 characters: letters, numbers and hyphens." : slugCheck.data?.available === false ? <span className={styles.error}>That URL is taken.</span> : slugCheck.data?.available ? "Available." : "Lowercase letters, numbers and hyphens."}
          {mode === "edit" ? " Changing it breaks links people have shared." : ""}
        </span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="artist-bio">
          About you
        </label>
        <Input.TextArea id="artist-bio" value={draft.bio} autoSize={{ minRows: 6 }} maxLength={10_000} placeholder="Who you are, what you make, why postcards. Markdown works." onChange={(e) => set("bio", e.target.value)} />
        <span className={styles.help}>Markdown: **bold**, _italics_, links, headings. Rendered on your page under your name.</span>
      </div>

      <div className={styles.field}>
        <span className={styles.label} id="artist-visibility-label">
          In the gallery
        </span>
        <Radio.Group
          aria-labelledby="artist-visibility-label"
          value={draft.visibility}
          onChange={(e) => set("visibility", e.target.value as ArtistVisibility)}
          options={[
            { value: "public", label: "Yes" },
            { value: "private", label: "No" },
          ]}
        />
        <span className={styles.help}>
          {draft.visibility === "public"
            ? "Your editions on sale appear in the site's gallery, with your name on them."
            : "Your editions show only on your own page, never in the site's gallery. People find you by your URL."}

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
        <span className={styles.label} id="artist-banner-label">
          Banner across the top of your page
        </span>
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
            <Button icon={<UploadOutlined />} loading={uploadBanner.isPending} aria-describedby="artist-banner-label">
              {draft.banner ? "Replace banner" : "Upload a banner"}
            </Button>
          </Upload>
          <span className={styles.help}>Required. Wide works best: it is shown about three times as wide as it is tall.</span>
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Where else to find you (optional)</span>
        {draft.links.length > 0 ? (
          <ul className={styles.linkList}>
            {draft.links.map((link, index) => (
              <li key={index} className={styles.linkRow}>
                <Input aria-label={`Link ${index + 1} label`} placeholder="Instagram, website, shop…" maxLength={40} value={link.label} onChange={(e) => setLink(index, { label: e.target.value })} className={styles.linkLabel} />
                <Input aria-label={`Link ${index + 1} URL`} placeholder="https://" inputMode="url" maxLength={500} value={link.url} onChange={(e) => setLink(index, { url: e.target.value })} />
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
        <span className={styles.help}>Your website, your shop, your accounts. Full links, starting with https://. A blank label shows the site's name.</span>
      </div>

      {error ? <Alert type="error" showIcon title={error} /> : null}

      <div className={styles.actions}>
        <Button type="primary" size="large" loading={pending.isPending} disabled={draft.name.trim() === "" || draft.slug.length < 3 || draft.banner === null} onClick={submit}>
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
  const customer = useCustomer();
  const store = useStore();

  return (
    <div>
      <h1>Open a studio</h1>
      <p style={{ maxWidth: "40rem" }}>
        You get a page at your own URL. On it you sell editions: 6 or 12 postcards — photos you took, each with a note — that collectors buy once
        and receive one by one. We print and mail every card. After printing and postage and a {store.pricing.platformFeePercent}% fee, the rest is yours.
      </p>
      <p style={{ maxWidth: "40rem" }}>Your page starts as a draft. Nobody sees it until you put an edition on sale and go live.</p>
      <ProfileForm
        mode="create"
        initial={{
          slug: slugify(customer.data?.name ?? ""),
          name: customer.data?.name ?? "",
          bio: "",
          visibility: "public",
          avatar: null,
          banner: null,
          links: [],
        }}
      />
    </div>
  );
}

/** "Your profile": the same form, filled in. */
export function StudioProfilePage() {
  const view = useOutletContext<StudioView>();
  const { artist } = view;

  return (
    <div>
      <h2>Your profile</h2>
      <ProfileForm
        mode="edit"
        initial={{
          slug: artist.slug,
          name: artist.name,
          bio: artist.bio,
          visibility: artist.visibility,
          avatar: artist.avatar,
          banner: artist.banner,
          links: artist.links,
        }}
      />
      <p className={cx(styles.note)} style={{ marginTop: "1.5rem" }}>
        Prices, sizes and schedules belong to each edition. <Link to="/studio/editions">Your editions</Link>.
      </p>
    </div>
  );
}
