import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { Alert, Button, Input, Radio, Skeleton } from "antd";
import { formatMoney } from "@shared/money";
import { DELIVERY_ESTIMATE } from "@shared/copy";
import { START_DATE_MAX_DAYS, artistPath, defaultStartDate, editionPath, editionSchedule, startDateProblem, startDateRange, type Cadence } from "@shared/platform";
import { todayIso, type Recipient } from "@shared/postcards";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { Field, RecipientFields } from "@/components/postcard/RecipientFields";
import { ApiError } from "@/lib/api";
import { useCustomer } from "@/lib/account";
import { useCollect, useEdition } from "@/lib/platform";
import { usePageTitle } from "@/lib/usePageTitle";
import { editionShape, formatMailDate, formatShortDate } from "@/lib/postcards";
import { BLANK_RECIPIENT, validateRecipient, type RecipientErrors } from "@/lib/recipient-form";
import { useStore } from "@/lib/useStore";
import { cx } from "@/lib/cx";
import { NotFoundPage } from "./NotFoundPage";
import styles from "@/components/platform/Platform.module.css";

/**
 * Collect an edition: where the cards go, how often, when the first one does, then Stripe.
 *
 * Signed in only — a run of cards has to belong to someone who can come back
 * and see where it is — so a visitor is sent to sign in with this page as the
 * way back. The address is prefilled from the account and saved back to it;
 * the price is shown from the edition and never sent.
 *
 * How often the cards come is the collector's call, once or twice a month,
 * and goes to the server with the order. The start date is optional. Left
 * empty, the server picks the next 1st or 15th; the page says which day that
 * is, and shows the whole run either way, worked out from the chosen cadence
 * by the same `editionSchedule` the server will use. The date's rules are
 * checked here with `startDateProblem` so the form can say so as you type,
 * and checked again on the server, which is the one that counts.
 */
export function CollectPage() {
  const { slug, edition: editionSlug } = useParams<{ slug: string; edition: string }>();
  const location = useLocation();
  const store = useStore();
  const customer = useCustomer();
  const page = useEdition(slug, editionSlug);
  const collect = useCollect();
  usePageTitle(page.data ? `Collect ${page.data.edition.title}` : null);

  const [draft, setDraft] = useState<Recipient>(BLANK_RECIPIENT);
  const [errors, setErrors] = useState<RecipientErrors>({});
  const [seeded, setSeeded] = useState(false);
  const [cadence, setCadence] = useState<Cadence>("monthly");
  /** Empty means "the default": the next 1st or 15th. */
  const [startDate, setStartDate] = useState("");

  // Prefill once from the account's saved address; typing afterwards wins.
  useEffect(() => {
    if (seeded || !customer.data) return;
    setSeeded(true);
    if (customer.data.address) setDraft(customer.data.address);
    else if (customer.data.name) setDraft((current) => ({ ...current, name: customer.data?.name ?? "" }));
  }, [customer.data, seeded]);

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

  const today = todayIso();
  const range = startDateRange(today);
  const fallback = defaultStartDate(today);
  const problem = startDate ? startDateProblem(startDate, today) : null;
  const schedule = problem ? null : editionSchedule(startDate || fallback, edition.cardCount, cadence);
  const months = cadence === "twice_monthly" ? edition.cardCount / 2 : edition.cardCount;
  const first = schedule?.[0];
  const last = schedule?.[schedule.length - 1];

  const submit = () => {
    const result = validateRecipient(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    if (problem) return;
    collect.mutate(
      { editionId: edition.id, address: result.value, cadence, ...(startDate ? { startDate } : {}) },
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
      <p>
        From <Link to={artistPath(artist.slug)}>{artist.name}</Link>: {editionShape(edition.cardCount)}, for {price}, paid once.
      </p>

      <div className={cx(styles.collectLayout)}>
        <div>
          <h2>Where should they go?</h2>
          <div className={styles.addressForm}>
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

          <h2 className={styles.startHeading}>How often?</h2>
          <div className={styles.startDate}>
            <Radio.Group
              aria-label="How often the cards come"
              value={cadence}
              onChange={(e) => setCadence(e.target.value as Cadence)}
              options={[
                { value: "monthly", label: "Once a month" },
                { value: "twice_monthly", label: "Twice a month" },
              ]}
            />
            <p className={styles.collectNote}>
              {cadence === "twice_monthly" ? "Two cards a month, about two weeks apart" : "One card a month"}: {edition.cardCount} cards take {months}{" "}
              months.
            </p>
          </div>

          <h2 className={styles.startHeading}>When should the first one go?</h2>
          <div className={styles.startDate}>
            <Field label="First card's day (optional)" error={problem ?? undefined}>
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  className={cx(styles.dateInput)}
                  value={startDate}
                  min={range.min}
                  max={range.max}
                  status={problem ? "error" : ""}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              )}
            </Field>
            <p className={styles.collectNote}>
              {startDate ? (
                <>
                  Any day from the 1st to the 28th, within the next {START_DATE_MAX_DAYS} days.{" "}
                  <Button type="link" size="small" className={cx(styles.inlineLink)} onClick={() => setStartDate("")}>
                    Use the default
                  </Button>
                </>
              ) : (
                <>Leave it empty and the first card goes on {formatMailDate(fallback, store.locale)}.</>
              )}
            </p>
            <div aria-live="polite" className={styles.schedulePreview}>
              {schedule && first && last ? (
                <>
                  <p>
                    Card 1 goes on <strong>{formatMailDate(first, store.locale)}</strong>, card {edition.cardCount} on{" "}
                    <strong>{formatMailDate(last, store.locale)}</strong>.
                  </p>
                  <ol className={styles.schedule} aria-label="Every card's day">
                    {schedule.map((date, index) => (
                      <li key={date}>
                        <span className={styles.editionCardNumber}>{index + 1}.</span> {formatShortDate(date, store.locale)}
                      </li>
                    ))}
                  </ol>
                </>
              ) : null}
            </div>
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
            <span className={styles.collectNote}>You'll pay on Stripe's secure page. We never see your card.</span>
          </div>
        </div>

        <aside className={styles.collectSummary} aria-label="What you're getting">
          <p>
            <strong>{price}</strong>
          </p>
          <p>
            {edition.cardCount} postcards from {artist.name}, printed and mailed to you {cadence === "twice_monthly" ? "twice a month" : "once a month"}. Each one is a
            surprise until it arrives.
          </p>
          <p>Nothing renews, so there's nothing to cancel; it ends on its own with the last card.</p>
          <p>{DELIVERY_ESTIMATE}</p>
          <p>Your address is saved to your account. If you move, change it there, and the cards still to come follow you.</p>
        </aside>
      </div>
    </PageWrapper>
  );
}
