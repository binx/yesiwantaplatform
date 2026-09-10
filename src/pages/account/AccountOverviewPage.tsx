import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Button, Form, Input, Tag, type InputRef } from "antd";
import { useClearReplySettings, useCustomer, useCustomerLogout, useSetReplySettings, useUpdateProfile } from "@/lib/account";
import { useStore } from "@/lib/useStore";
import { RecipientFields, VerificationNotice } from "@/components/postcard/RecipientFields";
import { BLANK_RECIPIENT, useRecipientCheck, validateRecipient, type RecipientErrors } from "@/lib/recipient-form";
import { formatRecipient, type Recipient } from "@shared/postcards";
import { useGallery } from "@/lib/gallery";
import { DesignCard } from "./AccountPostcardsPage";
import gallery from "./Gallery.module.css";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

export function AccountOverviewPage() {
  const customer = useCustomer();
  const update = useUpdateProfile();
  const logout = useCustomerLogout();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const recent = useGallery(3);
  const recentDesigns = recent.data?.pages[0]?.designs ?? [];

  useEffect(() => {
    document.title = "Account overview · Your account";
  }, []);

  if (!customer.data) return null;
  const profile = customer.data;

  return (
    <div>
      <div className={cx(styles.card)}>
        <div className={cx(styles.cardHeader)}>
          <div>
            <p>
              <strong>{profile.name ?? "No name set"}</strong>
            </p>
            <p className={cx(styles.meta)}>
              {profile.email}{" "}
              {profile.emailVerified ? (
                <Tag color="green">Verified</Tag>
              ) : (
                <Tag color="gold">Not verified</Tag>
              )}
            </p>
          </div>
          <div className={cx(styles.cardActions)}>
            <Button onClick={() => setEditing((v) => !v)}>{editing ? "Cancel" : "Edit name"}</Button>
          </div>
        </div>

        {editing ? (
          <Form
            layout="vertical"
            requiredMark={false}
            className={cx(styles.form)}
            disabled={update.isPending}
            initialValues={{ name: profile.name ?? "" }}
            onFinish={(values: { name: string }) => {
              update.mutate(
                { name: values.name.trim() === "" ? null : values.name },
                { onSuccess: () => setEditing(false) },
              );
            }}
          >
            {update.isError ? (
              <Alert
                className={cx(styles.alert)}
                type="error"
                showIcon
                title={update.error instanceof Error ? update.error.message : "Could not save."}
              />
            ) : null}
            <Form.Item name="name" label="Name">
              <Input autoComplete="name" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={update.isPending}>
              Save
            </Button>
          </Form>
        ) : null}

        {!profile.emailVerified ? (
          <Alert
            className={cx(styles.alert)}
            type="warning"
            showIcon
            title="Verify your email to see orders placed before you had an account."
          />
        ) : null}
      </div>

      {recentDesigns.length > 0 ? (
        <section className={cx(gallery.recent)} aria-labelledby="recent-heading">
          <h2 id="recent-heading">Your latest postcards</h2>
          <ul className={gallery.grid} aria-label="Latest postcards">
            {recentDesigns.map((design) => (
              <li key={design.id} className={gallery.card}>
                <DesignCard design={design} />
              </li>
            ))}
          </ul>
          <Link to="/account/postcards">All your postcards</Link>
        </section>
      ) : null}

      <ReplySettings displayName={profile.replyDisplayName} address={profile.replyAddress} />

      <Button
        loading={logout.isPending}
        onClick={() => logout.mutate(undefined, { onSuccess: () => void navigate("/") })}
      >
        Sign out
      </Button>
    </div>
  );
}

/**
 * Where a reply comes. Off until the customer fills it in, and never shown to
 * the person replying: checkout puts it on the card, and their order shows
 * only the name.
 */
function ReplySettings({ displayName, address }: { displayName: string | null; address: Recipient | null }) {
  const { locale } = useStore();
  const save = useSetReplySettings();
  const clear = useClearReplySettings();
  const check = useRecipientCheck();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(displayName ?? "");
  const [draft, setDraft] = useState<Recipient>(address ?? BLANK_RECIPIENT);
  const [errors, setErrors] = useState<RecipientErrors>({});
  const [nameError, setNameError] = useState<string | null>(null);
  const line1Ref = useRef<InputRef>(null);
  const on = address !== null;

  const open = () => {
    setName(displayName ?? "");
    setDraft(address ?? BLANK_RECIPIENT);
    setErrors({});
    setNameError(null);
    setEditing(true);
  };
  const close = () => {
    check.dismiss();
    setEditing(false);
  };

  const commit = (value: Recipient) => {
    save.mutate({ displayName: name.trim(), address: value }, { onSuccess: close });
  };
  const submit = () => {
    const trimmedName = name.trim();
    const result = validateRecipient(draft);
    setNameError(trimmedName === "" ? "A name is required." : trimmedName.length > 40 ? "40 characters at most." : null);
    if (!result.ok) setErrors(result.errors);
    if (trimmedName === "" || trimmedName.length > 40 || !result.ok) return;
    void check.run(result.value, commit);
  };

  return (
    <section className={cx(styles.card)} aria-labelledby="replies-heading">
      <div className={cx(styles.cardHeader)}>
        <div>
          <h2 id="replies-heading">Replies</h2>
          {on ? (
            <p className={cx(styles.meta)}>
              Replies are addressed to <strong>{displayName}</strong>, {formatRecipient(address, locale)}.
            </p>
          ) : (
            <p className={cx(styles.meta)}>
              Each card you send carries a small QR code. Scan it and the recipient can send you one back, without ever seeing
              your address. Add an address here to allow that.
            </p>
          )}
        </div>
        <div className={cx(styles.cardActions)}>
          {editing ? (
            <Button onClick={close}>Cancel</Button>
          ) : (
            <>
              <Button onClick={open}>{on ? "Change" : "Allow replies"}</Button>
              {on ? (
                <Button danger loading={clear.isPending} onClick={() => clear.mutate()}>
                  Turn off
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>

      {editing ? (
        <form
          className={cx(styles.form)}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {save.isError ? (
            <Alert className={cx(styles.alert)} type="error" showIcon title={save.error instanceof Error ? save.error.message : "Could not save."} />
          ) : null}
          <label className={cx(styles.field)}>
            <span>Name on the card</span>
            <Input
              value={name}
              maxLength={40}
              autoComplete="name"
              status={nameError ? "error" : ""}
              onChange={(event) => {
                setName(event.target.value);
                setNameError(null);
              }}
            />
            {nameError ? <span className={cx(styles.fieldError)}>{nameError}</span> : null}
          </label>
          <RecipientFields
            draft={draft}
            errors={errors}
            locale={locale}
            allowInternational={false}
            line1Ref={line1Ref}
            onChange={(key, value) => {
              setDraft((current) => ({ ...current, [key]: value }));
              if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
            }}
          />
          {check.check ? (
            <VerificationNotice
              check={check.check}
              locale={locale}
              onUse={check.useSuggested}
              onKeep={check.keepMine}
              onDismiss={check.dismiss}
              onEdit={() => {
                check.dismiss();
                line1Ref.current?.focus();
              }}
            />
          ) : null}
          <Button type="primary" htmlType="submit" loading={check.verifying || save.isPending}>
            Save
          </Button>
        </form>
      ) : null}
    </section>
  );
}
