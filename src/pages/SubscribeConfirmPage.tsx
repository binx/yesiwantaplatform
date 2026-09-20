import { useEffect } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { Button, Result, Skeleton } from "antd";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { useCustomer } from "@/lib/account";
import { useCheckoutSubscription } from "@/lib/platform";
import { useStore } from "@/lib/useStore";

/**
 * Where Stripe sends the subscriber back.
 *
 * The redirect is not proof of payment: the subscription is `incomplete`
 * until the webhook lands, and the page polls until it is not. Usually that
 * is a second or two; the copy says so rather than pretending.
 */
export function SubscribeConfirmPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const store = useStore();
  const customer = useCustomer();
  const sessionId = params.get("session_id");
  const subscription = useCheckoutSubscription(customer.data ? sessionId : null);

  useEffect(() => {
    document.title = `Thank you · ${store.name}`;
  }, [store.name]);

  if (customer.isPending) {
    return (
      <PageWrapper width="prose">
        <Skeleton active paragraph={{ rows: 4 }} />
      </PageWrapper>
    );
  }
  if (!customer.data) return <Navigate to="/account/login" replace state={{ from: `${location.pathname}${location.search}` }} />;

  if (!sessionId || subscription.isError) {
    return (
      <PageWrapper width="prose">
        <Result
          status="warning"
          title={<h1>We couldn't find that checkout</h1>}
          subTitle="If you just paid, your subscription is in your account."
          extra={
            <Link to="/account">
              <Button type="primary">Your account</Button>
            </Link>
          }
        />
      </PageWrapper>
    );
  }

  if (!subscription.data || subscription.data.status === "incomplete") {
    return (
      <PageWrapper width="prose">
        <Result status="info" title={<h1>Confirming your payment…</h1>} subTitle="Stripe is telling us it went through. This usually takes a moment." />
      </PageWrapper>
    );
  }

  const { artist } = subscription.data;
  return (
    <PageWrapper width="prose">
      <Result
        status="success"
        title={<h1>Yes! You'll get a postcard.</h1>}
        subTitle={`${artist.name}'s next card will be printed and mailed to ${subscription.data.address.name}. We'll email you the day it goes to print.`}
        extra={[
          <Link key="account" to="/account">
            <Button type="primary">Your subscriptions</Button>
          </Link>,
          <Link key="artists" to="/artists">
            <Button>Find another artist</Button>
          </Link>,
        ]}
      />
    </PageWrapper>
  );
}
