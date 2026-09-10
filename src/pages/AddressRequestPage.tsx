import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Result, Skeleton, type InputRef } from "antd";
import type { Recipient } from "@shared/postcards";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { RecipientFields, VerificationNotice } from "@/components/postcard/RecipientFields";
import { ApiError } from "@/lib/api";
import { fetchAddressRequest, respondToAddressRequest } from "@/lib/address-requests";
import { BLANK_RECIPIENT, useRecipientCheck, validateRecipient, type RecipientErrors } from "@/lib/recipient-form";
import { useStore } from "@/lib/useStore";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { cx } from "@/lib/cx";
import postcard from "@/components/postcard/Postcard.module.css";
import styles from "./AddressRequestPage.module.css";

/**
 * "Rachel would like to send you a postcard. Where should it go?"
 *
 * The page a friend lands on from a request link. No account, no sign-up,
 * nothing about the requester but a first name; one address, once, and
 * then it is done. The form is the designer's own, verification included,
 * so what lands in the requester's book is as good as what they would have
 * typed themselves.
 */
export function AddressRequestPage() {
  const { token = "" } = useParams();
  const store = useStore();
  useDocumentTitle("Share your address");

  const request = useQuery({
    queryKey: ["address-request", token],
    queryFn: ({ signal }) => fetchAddressRequest(token, signal),
    enabled: token !== "",
    retry: false,
  });

  const [draft, setDraft] = useState<Recipient>(BLANK_RECIPIENT);
  const [errors, setErrors] = useState<RecipientErrors>({});
  const check = useRecipientCheck();
  const line1Ref = useRef<InputRef>(null);
  const respond = useMutation({ mutationFn: (recipient: Recipient) => respondToAddressRequest(token, recipient) });

  useEffect(() => {
    if (request.data) document.title = `Share your address with ${request.data.requesterName}`;
  }, [request.data]);

  if (token === "" || (request.isError && request.error instanceof ApiError && request.error.status === 404)) {
    return (
      <PageWrapper width="prose">
        <Result status="warning" title={<h1>That link isn't one we know</h1>} subTitle="Check it against the message it came in, or ask for a new one." extra={<Home />} />
      </PageWrapper>
    );
  }

  if (request.isPending) {
    return (
      <PageWrapper width="prose">
        <Skeleton active paragraph={{ rows: 4 }} />
      </PageWrapper>
    );
  }

  if (request.isError) {
    return (
      <PageWrapper width="prose">
        <Result status="error" title={<h1>That did not work</h1>} subTitle="This link could not be opened. Try again in a moment." extra={<Home />} />
      </PageWrapper>
    );
  }

  const { requesterName, label, multi, status } = request.data;

  if (respond.isSuccess) {
    return (
      <PageWrapper width="prose">
        <Result status="success" title={<h1>Thanks — {requesterName} has your address</h1>} subTitle="That's all. Keep an eye on the letterbox." extra={<Home />} />
      </PageWrapper>
    );
  }

  const closed = respond.isError && respond.error instanceof ApiError && respond.error.status === 410;
  if (status !== "open" || closed) {
    const used = status === "fulfilled" || closed;
    return (
      <PageWrapper width="prose">
        <Result
          status="info"
          title={<h1>{used ? "This link has already been used" : "This link is no longer active"}</h1>}
          subTitle={used ? `If that wasn't you, ask ${requesterName} for a new one.` : `Ask ${requesterName} for a new one.`}
          extra={<Home />}
        />
      </PageWrapper>
    );
  }

  const set = (key: keyof Recipient, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  return (
    <PageWrapper width="prose">
      <h1>{requesterName} would like to send you a postcard.</h1>
      <p className={cx(styles.lead)}>
        {multi && label ? <>For <strong>{label}</strong>. </> : null}
        Where should it go? Only {requesterName} will see this, and it's used to address a postcard and
        nothing else.
      </p>

      <form
        className={cx(postcard.recipientForm, styles.form)}
        onSubmit={(event) => {
          event.preventDefault();
          const result = validateRecipient(draft);
          if (!result.ok) {
            setErrors(result.errors);
            return;
          }
          void check.run(result.value, (value) => respond.mutate(value));
        }}
      >
        <RecipientFields draft={draft} errors={errors} onChange={set} line1Ref={line1Ref} locale={store.locale} allowInternational={store.internationalPostcardPriceCents !== null} />

        {check.check ? (
          <VerificationNotice
            check={check.check}
            locale={store.locale}
            onUse={check.useSuggested}
            onKeep={check.keepMine}
            onDismiss={check.dismiss}
            onEdit={() => {
              check.dismiss();
              line1Ref.current?.focus();
            }}
          />
        ) : null}

        {respond.isError && !closed ? (
          <Alert type="error" showIcon title={respond.error instanceof Error ? respond.error.message : "That could not be sent. Try again."} />
        ) : null}

        <div className={postcard.recipientActions}>
          <Button type="primary" size="large" htmlType="submit" loading={check.verifying || respond.isPending}>
            Send my address
          </Button>
        </div>
      </form>
    </PageWrapper>
  );
}

function Home() {
  return (
    <Link to="/">
      <Button type="primary">Back to the store</Button>
    </Link>
  );
}
