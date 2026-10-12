import { App, Button, Input, Radio, Select, Upload } from "antd";
import { CameraOutlined, DeleteOutlined, PlusOutlined, UploadOutlined, UserOutlined } from "@ant-design/icons";
import { artistLinkLabel, instagramHandle, MAX_ARTIST_LINKS, type ArtistLinkKind, type ArtistVisibility } from "@shared/platform";
import { useUploadAvatar, useUploadBanner } from "@/lib/platform";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import { linkProblem, newLinkDraft, typedLinks, type LinkDraft, type ProfileDraft, type SetDraft } from "./profileDraft";
import styles from "./Studio.module.css";

/**
 * The top of the page as it will look: the banner, the photo over its
 * edge, the name and URL beside it. Both pictures upload from here. The
 * banner is required, and it is uploaded under the customer's id, so the
 * setup can show it before the artist row exists.
 */
export function ProfileHero({ draft, set }: { draft: ProfileDraft; set: SetDraft }) {
  const { message } = App.useApp();
  const uploadAvatar = useUploadAvatar();
  const uploadBanner = useUploadBanner();
  const host = window.location.host;
  const shownLinks = typedLinks(draft.links);

  return (
    <div className={styles.hero}>
      <div className={styles.heroBanner}>
        {draft.banner ? <img src={assetUrl(draft.banner.path)} alt="" /> : <div className={styles.heroBannerEmpty} aria-hidden />}
        <div className={styles.heroBannerActions}>
          <Upload
            accept="image/*"
            showUploadList={false}
            beforeUpload={(file) => {
              uploadBanner.mutate({ file, alt: "" }, { onSuccess: (image) => set("banner", image), onError: () => void message.error("That image could not be uploaded.") });
              return Upload.LIST_IGNORE;
            }}
          >
            <Button size="small" icon={<UploadOutlined />} loading={uploadBanner.isPending}>
              {draft.banner ? "Replace banner" : "Upload a banner"}
            </Button>
          </Upload>
        </div>
      </div>
      <div className={styles.heroBody}>
        <div className={styles.heroAvatar}>
          {draft.avatar ? (
            <img src={assetUrl(draft.avatar.path)} alt="" />
          ) : (
            <div className={styles.heroAvatarEmpty} aria-hidden>
              <UserOutlined />
            </div>
          )}
          <div className={styles.heroAvatarButton}>
            <Upload
              accept="image/*"
              showUploadList={false}
              beforeUpload={(file) => {
                uploadAvatar.mutate({ file, alt: draft.name }, { onSuccess: (image) => set("avatar", image), onError: () => void message.error("That image could not be uploaded.") });
                return Upload.LIST_IGNORE;
              }}
            >
              <Button shape="circle" icon={<CameraOutlined />} loading={uploadAvatar.isPending} aria-label={draft.avatar ? "Replace your photo" : "Add a photo of you"} title={draft.avatar ? "Replace your photo" : "Add a photo of you"} />
            </Upload>
          </div>
        </div>
        <div className={styles.heroIdentity}>
          <p className={cx(styles.heroName, draft.name.trim() === "" && styles.heroPlaceholder)}>{draft.name.trim() || "Your name"}</p>
          <p className={styles.heroUrl}>
            {host}/artist/{draft.slug || "…"}
          </p>
          {shownLinks.length > 0 ? (
            <ul className={styles.heroLinks} aria-label="Your links, as they will show">
              {shownLinks.map((link, index) => (
                <li key={index}>{artistLinkLabel(link) || "…"}</li>
              ))}
            </ul>
          ) : null}
        </div>
        {draft.avatar ? (
          <Button type="link" size="small" className={cx(styles.heroRemovePhoto)} onClick={() => set("avatar", null)}>
            Remove photo
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The artist's Markdown, under their name on the page. */
export function BioField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className={styles.field}>
      <label className="sr-only" htmlFor="artist-bio">
        About you
      </label>
      <Input.TextArea id="artist-bio" value={value} autoSize={{ minRows: 6 }} maxLength={10_000} placeholder="Who you are and what you make." onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

const LINK_KINDS: { value: ArtistLinkKind; label: string }[] = [
  { value: "website", label: "Website" },
  { value: "instagram", label: "Instagram" },
  { value: "custom", label: "Custom" },
];

/**
 * Where else to find them, one row per link, up to the limit. Each row
 * starts with what kind of link it is, and the kind decides the rest: a
 * website asks for its address, Instagram for a username, and custom for
 * a label and an address. A row says what is wrong with it while it is.
 * The Instagram field keeps only the username: a pasted profile address
 * or a leading "@" collapses to it as it is typed, and switching a row to
 * Instagram reads it out of an address already there.
 */
export function LinksFields({ links, onChange }: { links: LinkDraft[]; onChange: (links: LinkDraft[]) => void }) {
  const setLink = (index: number, patch: Partial<LinkDraft>) => onChange(links.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  return (
    <>
      {links.length > 0 ? (
        <ul className={styles.linkList}>
          {links.map((link, index) => {
            const n = index + 1;
            const problem = linkProblem(link);
            const status = problem ? ("error" as const) : "";
            return (
              <li key={index} className={styles.linkRow}>
                <Select aria-label={`Link ${n} kind`} className={cx(styles.linkKind)} value={link.kind} options={LINK_KINDS} onChange={(kind: ArtistLinkKind) => setLink(index, { kind, ...(kind === "instagram" && link.handle === "" ? { handle: instagramHandle(link.url) } : {}) })} />
                {link.kind === "instagram" ? (
                  <Input aria-label={`Link ${n} Instagram username`} prefix="@" autoComplete="off" maxLength={200} value={link.handle} status={status} onChange={(e) => setLink(index, { handle: instagramHandle(e.target.value) })} />
                ) : link.kind === "website" ? (
                  <Input aria-label={`Link ${n} address`} placeholder="https://" inputMode="url" maxLength={500} value={link.url} status={status} onChange={(e) => setLink(index, { url: e.target.value })} />
                ) : (
                  <div className={styles.linkCustom}>
                    <Input aria-label={`Link ${n} label`} placeholder="Shop, newsletter…" maxLength={40} value={link.label} onChange={(e) => setLink(index, { label: e.target.value })} />
                    <Input aria-label={`Link ${n} address`} placeholder="https://" inputMode="url" maxLength={500} value={link.url} status={status} onChange={(e) => setLink(index, { url: e.target.value })} />
                  </div>
                )}
                <Button aria-label={`Remove link ${n}`} icon={<DeleteOutlined />} onClick={() => onChange(links.filter((_, i) => i !== index))} />
                {problem ? <span className={cx(styles.error, styles.linkProblem)}>{problem}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div>
        <Button icon={<PlusOutlined />} disabled={links.length >= MAX_ARTIST_LINKS} onClick={() => onChange([...links, newLinkDraft(links)])}>
          Add a link
        </Button>
      </div>
    </>
  );
}

/** Listed in the site's gallery, or found by URL only. */
export function VisibilityField({ value, onChange, labelledBy }: { value: ArtistVisibility; onChange: (value: ArtistVisibility) => void; labelledBy: string }) {
  return (
    <Radio.Group
      aria-labelledby={labelledBy}
      optionType="button"
      value={value}
      onChange={(e) => onChange(e.target.value as ArtistVisibility)}
      options={[
        { value: "public", label: "Listed" },
        { value: "private", label: "Not listed" },
      ]}
    />
  );
}
