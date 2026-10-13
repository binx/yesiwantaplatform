import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { Alert, Button, Input, Radio, Select, Skeleton } from "antd";
import { formatMoney } from "@shared/money";
import { artistPath, defaultStartDate, editionPath, editionSchedule, startDateProblem, startDateRange, type Cadence } from "@shared/platform";
import { formatRecipient, todayIso, type Recipient } from "@shared/postcards";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { Field, RecipientFields } from "@/components/postcard/RecipientFields";
import { ApiError } from "@/lib/api";
import { useCollections, useCustomer } from "@/lib/account";
import { useCollect, useEdition } from "@/lib/platform";
import { usePageTitle } from "@/lib/usePageTitle";
import { editionShape, formatShortDate } from "@/lib/postcards";
import { BLANK_RECIPIENT, validateRecipient, type RecipientErrors } from "@/lib/recipient-form";
import { assetUrl } from "@/lib/store-source";
import { useStore } from "@/lib/useStore";
import { cx } from "@/lib/cx";
import { NotFoundPage } from "./NotFoundPage";
import styles from "@/components/platform/Platform.module.css";

/** The value of the address select that means "type one in". */
const NEW_ADDRESS = "new";

/** The same place, give or take spacing and case. */
function addressKey(address: Recipient): string {
  const part = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
  return [address.name, address.line1, address.line2, address.city, address.state, address.postalCode, address.country].map(part).join("|");
}

/**
 * Collect an edition: where the cards go, how often, when the first one goes, then Stripe.
 *
 * Signed in only — a run of cards has to belong to someone who can come back
 * and see where it is — so a visitor is sent to sign in with this page as the
 * way back. The price is shown from the edition and never sent.
 *
 * The address box starts from the account's own address. Every address this
 * person has mailed to before — the account's, and each collection's — is
 * offered in a select above the fields, and choosing one fills them in; the
 * select shows whichever saved address the fields currently match, or "New
 * address" when they match none. Someone with nothing saved sees the fields
 * alone. The server keeps the address on the account only when the account
 * has none yet, so a gift never overwrites the collector's own.
 *
 * The first card's day is filled in with the next 1st or 15th and can be
 * changed to any day from the 1st to the 28th within the next few weeks; the
 * run below it is worked out by the same `editionSchedule` the server will
 * use. The day's rules are checked here with `startDateProblem` so the form
 * can say so as you type, and again on the server, which is the one that
 * counts.
 */
export function CollectPage() {
  const { slug, edition: editionSlug } = useParams<{ slug: string; edition: string }>();
  const location = useLocation();
  const store = useStore();
  const customer = useCustomer();
  const collections = useCollections(Boolean(customer.data));
  const page = useEdition(slug, editionSlug);
  const collect = useCollect();
  usePageTitle(page.data ? `Collect ${page.data.edition.title}` : null);

  const today = todayIso();
  const [draft, setDraft] = useState<Recipient>(BLANK_RECIPIENT);
  const [errors, setErrors] = useState<RecipientErrors>({});
  const [seeded, setSeeded] = useState(false);
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [startDate, setStartDate] = useState(() => defaultStartDate(today));

  // Prefill once from the account's saved address; typing afterwards wins.
  useEffect(() => {
    if (seeded || !customer.data) return;
    setSeeded(true);
    setDraft(customer.data.address ?? { ...BLANK_RECIPIENT, name: customer.data.name ?? "" });
  }, [customer.data, seeded]);

  /** Everywhere this person has mailed to: the account's address first, then each collection's, no repeats. */
  const saved = useMemo(() => {
    const seen = new Map<string, Recipient>();
    for (const address of [customer.data?.address, ...(collections.data ?? []).map((collection) => collection.address)]) {
      if (address && !seen.has(addressKey(address))) seen.set(addressKey(address), address);
    }
    return [...seen.entries()].map(([key, address]) => ({ key, address }));
  }, [customer.data?.address, collections.data]);

  const chosen = saved.find((entry) => entry.key === addressKey(draft))?.key ?? NEW_ADDRESS;

  const chooseAddress = (key: string) => {
    setErrors({});
    const entry = saved.find((candidate) => candidate.key === key);
    setDraft(entry ? entry.address : { ...BLANK_RECIPIENT, country: draft.country });
  };

  if (customer.isPending || page.isPending) {
    return (
      <PageWrapper>
        <Skeleton active paragraph={{ rows: 8 }} />
      </PageWrapper>
    );
  }

  if (!customer.data) return <Navigate to="/account/login" replace state={{ from: location.pathname }} />;

  if (page.isError || !page.data) {
    if (page.error instanceof ApiError && page.error.status === 404) return <NotFoundPage />;
    return (
      <PageWrapper>
        <Alert type="error" showIcon title="This page could not be loaded." />
      </PageWrapper>
    );
  }

  const { artist, edition } = page.data;
  const price = formatMoney(edition.priceCents, edition.currency, store.locale);
  const backTo = editionPath(artist.slug, edition.slug);

  if (edition.status !== "on_sale" || artist.status !== "live") {
    return (
      <PageWrapper>
        <h1>{edition.title}</h1>
        <Alert
          type="info"
          showIcon
          title={edition.status === "closed" ? "This edition is closed to new collectors." : `${artist.name} isn't taking new collectors right now.`}
          description={<Link to={backTo}>Back to the edition</Link>}
        />
      </PageWrapper>
    );
  }

  const range = startDateRange(today);
  const problem = startDateProblem(startDate, today);
  const schedule = problem ? null : editionSchedule(startDate, edition.cardCount, cadence);

  const submit = () => {
    const result = validateRecipient(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    if (problem) return;
    collect.mutate(
      { editionId: edition.id, address: result.value, cadence, startDate },
      {
        onSuccess: ({ url }) => {
          window.location.assign(url);
        },
      },
    );
  };

  return (
    <PageWrapper width="wide">
      <h1>Collect {edition.title}</h1>

      <div className={cx(styles.collectLayout)}>
        <div>
          <h2>Mail to</h2>
          <div className={styles.addressForm}>
            {saved.length > 0 ? (
              <Field label="Address">
                {(id) => (
                  <Select
                    id={id}
                    value={chosen}
                    className={cx(styles.addressSelect)}
                    options={[
                      ...saved.map((entry) => ({ value: entry.key, label: `${entry.address.name}, ${formatRecipient(entry.address, store.locale)}` })),
                      { value: NEW_ADDRESS, label: "New address" },
                    ]}
                    onChange={chooseAddress}
                  />
                )}
              </Field>
            ) : null}
            <RecipientFields
              draft={draft}
              errors={errors}
              locale={store.locale}
              allowInternational
              onChange={(key, value) => {
                setDraft((current) => ({ ...current, [key]: value }));
                if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
              }}
            />
          </div>

          <h2 className={styles.startHeading}>When</h2>
          <div className={styles.startDate}>
            <Field label="How often">
              {(id) => (
                <Radio.Group
                  id={id}
                  aria-label="How often"
                  value={cadence}
                  onChange={(e) => setCadence(e.target.value as Cadence)}
                  options={[
                    { value: "monthly", label: "Once a month" },
                    { value: "twice_monthly", label: "Twice a month" },
                  ]}
                />
              )}
            </Field>
            <Field label="First card mails on" error={problem ?? undefined}>
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  className={cx(styles.dateInput)}
                  value={startDate}
                  min={range.min}
                  max={range.max}
                  status={problem ? "error" : ""}
                  onChange={(e) => setStartDate(e.target.value || defaultStartDate(today))}
                />
              )}
            </Field>
            {schedule ? (
              <ol className={styles.schedule} aria-label="Every card's day" aria-live="polite">
                {schedule.map((date, index) => (
                  <li key={date}>
                    <span className={styles.editionCardNumber}>{index + 1}.</span> {formatShortDate(date, store.locale)}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>

          {collect.isError ? (
            <Alert
              style={{ marginTop: "1rem" }}
              type="error"
              showIcon
              title={collect.error instanceof Error ? collect.error.message : "Something went wrong."}
              description={collect.error instanceof ApiError && collect.error.status === 409 ? <Link to="/account/collections">Your collections</Link> : null}
            />
          ) : null}

          <div className={styles.actions}>
            <Button type="primary" size="large" loading={collect.isPending} onClick={submit}>
              Continue to payment
            </Button>
          </div>
        </div>

        <aside className={styles.collectSummary} aria-label="What you're getting">
          {edition.banner ? (
            <img className={styles.collectImage} src={assetUrl(edition.banner.path)} alt={edition.banner.alt} width={edition.banner.width} height={edition.banner.height} />
          ) : null}
          <p className={styles.collectTitle}>{edition.title}</p>
          <p className={styles.collectNote}>
            by <Link to={artistPath(artist.slug)}>{artist.name}</Link> · {editionShape(edition.cardCount)}
          </p>
          <p className={styles.collectPrice}>{price}</p>
        </aside>
      </div>
    </PageWrapper>
  );
}
