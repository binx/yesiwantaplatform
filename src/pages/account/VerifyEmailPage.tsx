import { useEffect, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Result, Skeleton } from "antd";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { useVerifyEmail } from "@/lib/account";

/**
 * Redeem an email-verification link.
 *
 * Public: the customer may not be signed in yet on this device. The token
 * lives in the URL and is spent here — the server looks it up by hash, so a
 * tampered link simply matches nothing. Success signs the customer in.
 */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const verify = useVerifyEmail();
  const attempted = useRef(false);

  // Where the register route sent the verification link's `next` — a link
  // is copyable and forwardable, so this gets the same guard the server
  // applied before it ever put the value in the email: one leading slash,
  // never `//host` (a protocol-relative redirect off-site).
  const nextParam = params.get("next");
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/account";


  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    verify.mutate(token, { onSuccess: () => void navigate(next, { replace: true }) });
  }, [token, verify, navigate, next]);

  if (!token) {
    return (
      <PageWrapper width="prose">
        <Result
          status="warning"
          title={<h1>No verification link</h1>}
          subTitle="This page is opened from the link in your verification email."
          extra={
            <Link to="/account/login">
              <Button type="primary">Back to sign in</Button>
            </Link>
          }
        />
      </PageWrapper>
    );
  }

  if (verify.isError) {
    return (
      <PageWrapper width="prose">
        <Result
          status="error"
          title={<h1>That link did not work</h1>}
          subTitle={
            verify.error instanceof Error
              ? verify.error.message
              : "That verification link could not be used."
          }
          extra={
            <Link to="/account/login">
              <Button type="primary">Back to sign in</Button>
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
