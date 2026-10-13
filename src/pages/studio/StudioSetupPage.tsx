import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, App, Button, Input } from "antd";
import { artistProfileInputSchema, type ArtistProfileInput } from "@shared/platform";
import { useCreateArtist, useSlugAvailable } from "@/lib/platform";
import { useCustomer } from "@/lib/account";
import { cx } from "@/lib/cx";
import { slugify, typedLinks, type ProfileDraft } from "./profileDraft";
import { BioField, LinksFields, ProfileHero, VisibilityField } from "./profileFields";
import styles from "./Studio.module.css";

const STEPS = ["Name and URL", "Your page", "Open"];

/**
 * Opening a studio, in three steps at /studio/new: the name and the URL,
 * which is chosen here and never again; the page's banner, photo and
 * words; then the links, the gallery switch, and the button that makes the
 * artist row. Nothing is written until that button: the pictures upload
 * under the customer's id as they go, the rest is held here.
 *
 * Only someone who came here opens a studio. A signed-in collector who
 * wanders to /studio is sent to the pitch, not to this form.
 */
export function StudioSetupPage() {
  const customer = useCustomer();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const create = useCreateArtist();
  const [step, setStep] = useState(0);
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>({
    slug: slugify(customer.data?.name ?? ""),
    name: customer.data?.name ?? "",
    bio: "",
    visibility: "public",
    avatar: null,
    banner: null,
    links: [],
  });
  const slugCheck = useSlugAvailable(draft.slug, step === 0);
  const host = window.location.host;

  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const slugProblem = draft.slug.length >= 3 && slugCheck.data?.available === false ? "That URL is taken." : null;
  const named = draft.name.trim() !== "" && draft.slug.length >= 3 && slugCheck.data?.available === true;

  const open = () => {
    const parsed = artistProfileInputSchema.safeParse({
      slug: draft.slug,
      name: draft.name,
      bio: draft.bio,
      visibility: draft.visibility,
      avatar: draft.avatar,
      banner: draft.banner,
      links: typedLinks(draft.links),
    } satisfies Record<keyof ArtistProfileInput, unknown>);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setError(null);
    create.mutate(parsed.data, {
      onSuccess: () => {
        message.success("Your studio is open.");
        void navigate("/studio");
      },
      onError: (err: unknown) => setError(err instanceof Error ? err.message : "Could not open your studio."),
    });
  };

  return (
    <div className={styles.setup}>
      <h1>Open a studio</h1>
      {/* The steps in the pitch page's own style, not antd's: the current one ringed in the chroma, the done ones filled with it. */}
      <ol className={cx(styles.setupSteps)} aria-label="Steps">
        {STEPS.map((title, index) => (
          <li key={title} className={cx(styles.setupStep, index < step && styles.setupStepDone, index === step && styles.setupStepCurrent)} aria-current={index === step ? "step" : undefined}>
            <span className={styles.setupStepNumber} aria-hidden>
              {index < step ? "✓" : index + 1}
            </span>
            {title}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className={styles.setupPanel}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="artist-name">
              Your name
            </label>
            <Input
              id="artist-name"
              size="large"
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
              size="large"
              prefix={<span className={styles.slugPreview}>{`${host}/artist/`}</span>}
              value={draft.slug}
              maxLength={40}
              status={slugProblem ? "error" : ""}
              onChange={(e) => {
                setSlugTouched(true);
                set("slug", slugify(e.target.value));
              }}
            />
            {slugProblem ? <span className={styles.error}>{slugProblem}</span> : null}
          </div>
        </div>
      ) : step === 1 ? (
        <div className={styles.profile}>
          <ProfileHero draft={draft} set={set} />
          <div className={styles.setupFields}>
            <BioField value={draft.bio} onChange={(bio) => set("bio", bio)} />
          </div>
        </div>
      ) : (
        <div className={styles.setupPanel}>
          <div className={styles.field}>
            <span className={styles.label} id="setup-links">
              Where else to find you
            </span>
            <LinksFields links={draft.links} onChange={(links) => set("links", links)} />
          </div>
          <div className={styles.field}>
            <span className={styles.label} id="setup-visibility">
              In the gallery
            </span>
            <VisibilityField value={draft.visibility} onChange={(visibility) => set("visibility", visibility)} labelledBy="setup-visibility" />
            <span className={styles.help}>Listed lets each edition you put on sale appear in the gallery. Not listed keeps them all to your own page, which anyone with the link can still visit.</span>
          </div>
        </div>
      )}

      {error ? <Alert type="error" showIcon title={error} /> : null}
      <div className={styles.setupButtons}>
        {step > 0 ? (
          <Button size="large" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        ) : null}
        {step < STEPS.length - 1 ? (
          <Button type="primary" size="large" disabled={step === 0 ? !named : draft.banner === null} onClick={() => setStep(step + 1)}>
            Continue
          </Button>
        ) : (
          <Button type="primary" size="large" loading={create.isPending} onClick={open}>
            View your studio
          </Button>
        )}
      </div>
    </div>
  );
}
