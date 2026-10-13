import { App, Button, Input, Radio, Upload } from "antd";
import { CameraOutlined, DeleteOutlined, PlusOutlined, UploadOutlined, UserOutlined } from "@ant-design/icons";
import { artistLinkLabel, MAX_ARTIST_LINKS, type ArtistLink, type ArtistVisibility } from "@shared/platform";
import { useUploadAvatar, useUploadBanner } from "@/lib/platform";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import { typedLinks, type ProfileDraft, type SetDraft } from "./profileDraft";
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

/** Where else to find them: a label and an address per row, up to the limit. */
export function LinksFields({ links, onChange }: { links: ArtistLink[]; onChange: (links: ArtistLink[]) => void }) {
  const setLink = (index: number, patch: Partial<ArtistLink>) => onChange(links.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  return (
    <>
      {links.length > 0 ? (
        <ul className={styles.linkList}>
          {links.map((link, index) => (
            <li key={index} className={styles.linkRow}>
              <Input aria-label={`Link ${index + 1} label`} placeholder="Instagram, website, shop…" maxLength={40} value={link.label} onChange={(e) => setLink(index, { label: e.target.value })} className={styles.linkLabel} />
              <Input aria-label={`Link ${index + 1} URL`} placeholder="https://" inputMode="url" maxLength={500} value={link.url} onChange={(e) => setLink(index, { url: e.target.value })} />
              <Button aria-label={`Remove link ${index + 1}`} icon={<DeleteOutlined />} onClick={() => onChange(links.filter((_, i) => i !== index))} />
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <Button icon={<PlusOutlined />} disabled={links.length >= MAX_ARTIST_LINKS} onClick={() => onChange([...links, { label: "", url: "" }])}>
          Add a link
        </Button>
      </div>
    </>
  );
}

/** What each choice means to the artist, told as what happens to their work. One line per option, in option order. */
const GALLERY_STORIES: ReadonlyArray<{ option: string; story: string }> = [
  { option: "Listed", story: "your editions appear in the gallery, where anyone browsing the site can find them. Show your work to the world." },
  { option: "Not listed", story: "your editions stay out of the gallery, but anyone you send the link can still collect. Made for a series just for friends and family." },
];

/** The gallery stories, to sit under `VisibilityField`. In ink, not muted: this is the one explanation the studio keeps, and it has to be read. */
export function GalleryStories() {
  return (
    <div className={styles.stories}>
      {GALLERY_STORIES.map(({ option, story }) => (
        <p key={option}>
          <strong>{option}:</strong> {story}
        </p>
      ))}
    </div>
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
