import { useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { Alert, App, Button, Input } from "antd";
import { artistProfileUpdateSchema, type ArtistProfileUpdate } from "@shared/platform";
import { useUpdateProfile, type StudioView } from "@/lib/platform";
import { typedLinks, type ProfileDraft } from "./profileDraft";
import { BioField, LinksFields, ProfileHero, VisibilityField } from "./profileFields";
import styles from "./Studio.module.css";

/**
 * "Your profile": the page's own form, laid out like the page. The banner
 * and the photo first, as they will look, with the name and URL beside
 * them, then the words, the links and the gallery switch in sections.
 *
 * The URL is shown, not edited: it was chosen when the studio opened, and
 * links people have shared keep working. Prices live on editions, not here.
 */
export function StudioProfilePage() {
  const { artist } = useOutletContext<StudioView>();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const update = useUpdateProfile();
  const [draft, setDraft] = useState<ProfileDraft>({
    slug: artist.slug,
    name: artist.name,
    bio: artist.bio,
    visibility: artist.visibility,
    avatar: artist.avatar,
    banner: artist.banner,
    links: artist.links,
  });
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = () => {
    const parsed = artistProfileUpdateSchema.safeParse({
      name: draft.name,
      bio: draft.bio,
      visibility: draft.visibility,
      avatar: draft.avatar,
      banner: draft.banner,
      links: typedLinks(draft.links),
    } satisfies Record<keyof ArtistProfileUpdate, unknown>);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setError(null);
    update.mutate(parsed.data, {
      onSuccess: () => {
        message.success("Saved.");
        void navigate("/studio");
      },
      onError: (err: unknown) => setError(err instanceof Error ? err.message : "Could not save."),
    });
  };

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>Your profile</h2>
      </div>
      <div className={styles.profile}>
        <ProfileHero draft={draft} set={set} />

        <section className={styles.section}>
          <div className={styles.sectionIntro}>
            <h3 id="profile-identity">Your name</h3>
          </div>
          <div className={styles.sectionFields}>
            <div className={styles.field}>
              <label className="sr-only" htmlFor="artist-name">
                Your name
              </label>
              <Input id="artist-name" size="large" value={draft.name} maxLength={80} onChange={(e) => set("name", e.target.value)} />
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionIntro}>
            <h3 id="profile-about">About you</h3>
          </div>
          <div className={styles.sectionFields}>
            <BioField value={draft.bio} onChange={(bio) => set("bio", bio)} />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionIntro}>
            <h3 id="profile-links">Where else to find you</h3>
          </div>
          <div className={styles.sectionFields}>
            <LinksFields links={draft.links} onChange={(links) => set("links", links)} />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionIntro}>
            <h3 id="profile-visibility">In the gallery</h3>
            <p>Listed lets each edition you put on sale appear in the gallery. Not listed keeps them all to your own page, which anyone with the link can still visit.</p>
          </div>
          <div className={styles.sectionFields}>
            <div className={styles.field}>
              <VisibilityField value={draft.visibility} onChange={(visibility) => set("visibility", visibility)} labelledBy="profile-visibility" />
            </div>
          </div>
        </section>

        <div className={styles.profileFooter}>
          {error ? <Alert type="error" showIcon title={error} /> : null}
          <div className={styles.profileButtons}>
            <Link to="/studio">
              <Button size="large">Cancel</Button>
            </Link>
            <Button type="primary" size="large" loading={update.isPending} disabled={draft.name.trim() === "" || draft.banner === null} onClick={submit}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
