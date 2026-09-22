import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { Alert, Button, Skeleton } from "antd";
import { formatMoney } from "@shared/money";
import type { Recipient } from "@shared/postcards";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { RecipientFields } from "@/components/postcard/RecipientFields";
import { ApiError } from "@/lib/api";
import { useCustomer } from "@/lib/account";
import { useArtist, useSubscribe } from "@/lib/platform";
import { BLANK_RECIPIENT, validateRecipient, type RecipientErrors } from "@/lib/recipient-form";
import { useStore } from "@/lib/useStore";
import { cx } from "@/lib/cx";
import { NotFoundPage } from "./NotFoundPage";
import styles from "@/components/platform/Platform.module.css";

/**
 * Say yes: where the cards go, then Stripe.
 *
 * Signed in only — a subscription has to belong to someone who can come back
 * and cancel it — so a visitor is sent to sign in with this page as the way
 * back. The address is prefilled from the account and saved back to it; the
 * price is shown from the artist's page and never sent.
 */
export function SubscribePage() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const store = useStore();
  const customer = useCustomer();
  const page = useArtist(slug);
  const subscribe = useSubscribe();

  const [draft, setDraft] = useState<Recipient>(BLANK_RECIPIENT);
  const [errors, setErrors] = useState<RecipientErrors>({});
  const [seeded, setSeeded] = useState(false);


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

  const { artist } = page.data;
  const price = formatMoney(artist.monthlyPriceCents, artist.currency, store.locale);

  const submit = () => {
    const result = validateRecipient(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    subscribe.mutate(
      { artistId: artist.id, address: result.value },
      {
        onSuccess: ({ url }) => {
          window.location.assign(url);
        },
      },
    );
  };

  return (
    <PageWrapper width="wide">
      <h1>Yes, you want a postcard</h1>
      <p>
        From <Link to={`/artist/${artist.slug}`}>{artist.name}</Link>, once a month for {artist.termMonths} {artist.termMonths === 1 ? "month" : "months"}, at {price} a month.
      </p>

      <div className={cx(styles.subscribeLayout)}>
        <div>
          <h2>Where should it go?</h2>
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

          {subscribe.isError ? (
            <Alert
              style={{ marginTop: "1rem" }}
              type="error"
              showIcon
              title={subscribe.error instanceof Error ? subscribe.error.message : "Something went wrong."}
              description={subscribe.error instanceof ApiError && subscribe.error.status === 409 ? <Link to="/account">Your subscriptions</Link> : null}
            />
          ) : null}

          <div className={styles.actions}>
            <Button type="primary" size="large" loading={subscribe.isPending} onClick={submit}>
              Continue to payment
            </Button>
            <span className={styles.subscribeNote}>You'll pay on Stripe's secure page. We never see your card.</span>
          </div>
        </div>

        <aside className={styles.subscribeSummary} aria-label="What you're getting">
          <p>
            <strong>{price} a month</strong>
          </p>
          <p>One postcard from {artist.name}, printed and mailed to you around the {artist.sendDay}th of each month.</p>
          <p>
            {artist.termMonths === 1
              ? "One month, one card, one payment. It ends on its own."
              : `${artist.termMonths} months, ${artist.termMonths} cards. You're billed each month, and it ends on its own after the last one — nothing to remember to cancel.`}
          </p>
          <p>Your address is saved to your account and used for every subscription. Change it there any time.</p>
          <p>Stop early from your account whenever you like. The current month's card still comes.</p>
        </aside>
      </div>
    </PageWrapper>
  );
}
