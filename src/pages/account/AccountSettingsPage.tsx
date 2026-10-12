import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, App, Button, Form, Input } from "antd";
import type { Recipient } from "@shared/postcards";
import { formatRecipient } from "@shared/postcards";
import { RecipientFields } from "@/components/postcard/RecipientFields";
import { useCustomer, useCustomerLogout, useUpdateAddress, useUpdateProfile } from "@/lib/account";
import { BLANK_RECIPIENT, validateRecipient, type RecipientErrors } from "@/lib/recipient-form";
import { useStore } from "@/lib/useStore";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

/**
 * The account's front page: your studio if you have one, who you are,
 * where your cards go, and the way out.
 *
 * The address is one per account. Checkout starts from it and saves what
 * was typed back to it, and changing it here is copied onto every
 * collection with cards still to come, so moving house is one form. A set
 * sent as a gift has its own address on its purchase, shown on the
 * collection's page.
 */
export function AccountSettingsPage() {
  const customer = useCustomer();
  const logout = useCustomerLogout();
  const navigate = useNavigate();

  if (!customer.data) return null;
  const profile = customer.data;

  return (
    <div>
      {profile.artistSlug ? (
        <section className={cx(styles.card, styles.studioCard)} aria-labelledby="settings-studio">
          <h2 id="settings-studio" className={styles.settingsTitle}>
            Your studio
          </h2>
          <p className={styles.settingsRow}>
            <span>
              Editions and payouts are in your studio. Your artist page is{" "}
              <Link to={`/artist/${profile.artistSlug}`}>/artist/{profile.artistSlug}</Link>.
            </span>
            <Link to="/studio">
              <Button type="primary">Open your studio</Button>
            </Link>
          </p>
        </section>
      ) : null}

      <section className={cx(styles.card)} aria-labelledby="settings-you">
        <h2 id="settings-you" className={styles.settingsTitle}>
          You
        </h2>
        <NameRow name={profile.name} />
        <p className={cx(styles.meta)}>
          {profile.email}{" "}
          {profile.emailVerified ? <span className={styles.badge}>Verified</span> : <span className={cx(styles.badge, styles.badgeWarn)}>Not verified</span>}
        </p>
      </section>

      <section className={cx(styles.card)} aria-labelledby="settings-address">
        <h2 id="settings-address" className={styles.settingsTitle}>
          Where your cards go
        </h2>
        <AddressSection address={profile.address} fallbackName={profile.name ?? ""} />
      </section>

      <p>
        <Button loading={logout.isPending} onClick={() => logout.mutate(undefined, { onSuccess: () => void navigate("/") })}>
          Sign out
        </Button>
      </p>
    </div>
  );
}

/** The name on the account, shown as text until you ask to change it. */
function NameRow({ name }: { name: string | null }) {
  const update = useUpdateProfile();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <Form
        layout="inline"
        initialValues={{ name: name ?? "" }}
        onFinish={(values: { name: string }) => update.mutate({ name: values.name.trim() || null }, { onSuccess: () => setEditing(false) })}
      >
        <Form.Item name="name" label="Name">
          <Input autoFocus />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={update.isPending}>
          Save
        </Button>
        <Button type="link" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </Form>
    );
  }

  return (
    <p className={styles.settingsRow}>
      <strong>{name ?? "No name set"}</strong>
      <Button size="small" onClick={() => setEditing(true)}>
        {name ? "Change name" : "Add a name"}
      </Button>
    </p>
  );
}

/** The saved address as a sentence, with the form behind one control. */
function AddressSection({ address, fallbackName }: { address: Recipient | null; fallbackName: string }) {
  const store = useStore();
  const update = useUpdateAddress();
  const { message } = App.useApp();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Recipient>(address ?? { ...BLANK_RECIPIENT, name: fallbackName });
  const [errors, setErrors] = useState<RecipientErrors>({});

  const submit = () => {
    const result = validateRecipient(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    update.mutate(result.value, {
      onSuccess: ({ verification }) => {
        message.success(verification.changed && verification.suggested ? "Saved. USPS knows it slightly differently; that's fine." : "Saved.");
        setEditing(false);
      },
    });
  };

  if (!editing) {
    return (
      <p className={styles.settingsRow}>
        {address ? (
          <span>
            <strong>{address.name}</strong>, {formatRecipient(address, store.locale)}
          </span>
        ) : (
          <span className={cx(styles.meta)}>No address yet.</span>
        )}
        <Button size="small" onClick={() => setEditing(true)}>
          {address ? "Change address" : "Add an address"}
        </Button>
      </p>
    );
  }

  return (
    <>
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

      {update.isError ? <Alert className={cx(styles.alert)} type="error" showIcon title={update.error instanceof Error ? update.error.message : "Could not save."} /> : null}

      <p className={styles.actions}>
        <Button type="primary" loading={update.isPending} onClick={submit}>
          Save address
        </Button>
        <Button type="link" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </p>
      <p className={cx(styles.meta)}>Every card still to come, from every edition you collect, goes to the new address. A card already at the printer goes to the old one.</p>
    </>
  );
}
