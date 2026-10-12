import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { Button, Result, Skeleton } from "antd";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { useCustomer } from "@/lib/account";
import { useCheckoutCollection } from "@/lib/platform";
import { usePageTitle } from "@/lib/usePageTitle";
import { formatMailDate, formatShortDate } from "@/lib/postcards";
import { useStore } from "@/lib/useStore";
import styles from "@/components/platform/Platform.module.css";

/**
 * Where Stripe sends the collector back.
 *
 * The redirect is not proof of payment: the purchase is `incomplete` until
 * the webhook lands, and the page polls until it is not. Usually that is a
 * second or two; the copy says so rather than pretending. Once it is paid,
 * the page shows the run: every card's day, first to last.
 */
export function CollectConfirmPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const store = useStore();
  const customer = useCustomer();
  const sessionId = params.get("session_id");
  const collection = useCheckoutCollection(customer.data ? sessionId : null);
  usePageTitle("Your collection");

  if (customer.isPending) {
    return (
      <PageWrapper width="prose">
        <Skeleton active paragraph={{ rows: 4 }} />
      </PageWrapper>
    );
  }
  if (!customer.data) return <Navigate to="/account/login" replace state={{ from: `${location.pathname}${location.search}` }} />;

  if (!sessionId || collection.isError) {
    return (
      <PageWrapper width="prose">
        <Result
          status="warning"
          title={<h1>We couldn't find that checkout</h1>}
          subTitle="If you just paid, what you collected is in your account."
          extra={
            <Link to="/account/collections">
              <Button type="primary">Your collections</Button>
            </Link>
          }
        />
      </PageWrapper>
    );
  }

  if (!collection.data || collection.data.status === "incomplete") {
    return (
      <PageWrapper width="prose">
        <Result status="info" title={<h1>Confirming your payment…</h1>} subTitle="Stripe is telling us it went through. This usually takes a moment." />
      </PageWrapper>
    );
  }

  const { artist, edition, schedule, address } = collection.data;
  const first = schedule[0];
  return (
    <PageWrapper width="prose">
      <Result
        status="success"
        title={<h1>Yes! You'll get postcards.</h1>}
        subTitle={
          first
            ? `${edition.title} by ${artist.name}: the first card is printed and mailed to ${address.name} on ${formatMailDate(first.mailDate, store.locale)}. We'll email you as each one goes out.`
            : `${edition.title} by ${artist.name}, mailed to ${address.name}.`
        }
        extra={[
          <Link key="account" to="/account/collections">
            <Button type="primary">Your collections</Button>
          </Link>,
          <Link key="artists" to="/artists">
            <Button>Find another artist</Button>
          </Link>,
        ]}
      />
      {schedule.length > 0 ? (
        <>
          <h2>When each card goes</h2>
          <ol className={styles.schedule}>
            {schedule.map((card) => (
              <li key={card.position}>
                <span className={styles.editionCardNumber}>{card.position}.</span> {formatShortDate(card.mailDate, store.locale)}
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </PageWrapper>
  );
}
