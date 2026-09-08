import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Result, Skeleton } from "antd";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { useUnsubscribeCartRecovery } from "@/lib/cart-recovery";

/**
 * Redeem a cart-reminder unsubscribe link.
 *
 * Public, and idempotent on the server — clicking it twice only ever opts
 * out — so unlike `VerifyEmailPage` there is no meaningful "already used"
 * error state to show.
 */
export function UnsubscribeCartRecoveryPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const unsubscribe = useUnsubscribeCartRecovery();
  const attempted = useRef(false);

  useEffect(() => {
    document.title = "Unsubscribe · Beluga";
  }, []);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    unsubscribe.mutate(token);
  }, [token, unsubscribe]);

  if (!token) {
    return (
      <PageWrapper width="prose">
        <Result
          status="warning"
          title={<h1>No unsubscribe link</h1>}
          subTitle="This page is opened from the link in a cart reminder email."
          extra={
            <Link to="/">
              <Button type="primary">Back to the store</Button>
            </Link>
          }
        />
      </PageWrapper>
    );
  }

  if (unsubscribe.isError) {
    return (
      <PageWrapper width="prose">
        <Result
          status="error"
          title={<h1>That did not work</h1>}
          subTitle="This link could not be used. It may be malformed."
          extra={
            <Link to="/">
              <Button type="primary">Back to the store</Button>
            </Link>
          }
        />
      </PageWrapper>
    );
  }

  if (unsubscribe.isSuccess) {
    return (
      <PageWrapper width="prose">
        <Result
          status="success"
          title={<h1>Unsubscribed</h1>}
          subTitle="You won't get any more cart reminder emails."
          extra={
            <Link to="/">
              <Button type="primary">Back to the store</Button>
            </Link>
          }
        />
      </PageWrapper>
    );
  }

  return (
    <PageWrapper width="prose">
      <Skeleton active paragraph={{ rows: 3 }} />
    </PageWrapper>
  );
}
