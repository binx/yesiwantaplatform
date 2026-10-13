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
import { EditButton } from "./EditButton";
import styles from "./Account.module.css";

/**
 * The account's front page: your studio if you have one, then your name,
 * email and where your cards go in one box, and the way out.
 *
 * The address here is a default, one per account: checkout starts from it
 * and, when the set is the collector's own, saves what was typed back to it.
 * Changing it moves no collection. Each purchase keeps its own address,
 * shown and changed on the collection's page.
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
        <nav className={styles.studio} aria-label="Your studio">
          <div className={styles.studioButtons}>
            <Link to="/studio">
              <Button type="primary" size="large" block>
                Open your studio
              </Button>
            </Link>
            <Link to={`/artist/${profile.artistSlug}`}>
              <Button size="large" block>
                View your artist page
              </Button>
            </Link>
          </div>
          {profile.artistReviewStatus === "pending" || profile.artistReviewStatus === "declined" || profile.editionsInReview > 0 ? (
            <p className={cx(styles.meta)} role="status">
              {profile.artistReviewStatus === "pending" ? (
                <span className={cx(styles.badge, styles.badgeWarn)}>Your page is waiting for review</span>
              ) : profile.artistReviewStatus === "declined" ? (
                <span className={cx(styles.badge, styles.badgeWarn)}>Your page wasn't approved</span>
              ) : null}
              {profile.editionsInReview > 0 ? (
                <span className={cx(styles.badge, styles.badgeWarn)}>
                  {profile.editionsInReview === 1 ? "An edition is" : `${profile.editionsInReview} editions are`} waiting for review
                </span>
              ) : null}
            </p>
          ) : null}
        </nav>
      ) : null}

      <section className={cx(styles.card)} aria-labelledby="settings-account">
        <h2 id="settings-account" className={styles.settingsTitle}>
          Account
        </h2>
        <div className={styles.accountRows}>
          <NameRow name={profile.name} />
          <div className={styles.accountRow}>
            <span className={styles.accountLabel}>Email</span>
            <span>
              {profile.email}{" "}
              {profile.emailVerified ? <span className={styles.badge}>Verified</span> : <span className={cx(styles.badge, styles.badgeWarn)}>Not verified</span>}
            </span>
          </div>
          <AddressSection address={profile.address} fallbackName={profile.name ?? ""} />
        </div>
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
      <div className={styles.accountRow}>
        <label htmlFor="account-name" className={styles.accountLabel}>
          Name
        </label>
        <Form
          className={styles.accountInlineEdit}
          layout="inline"
          initialValues={{ name: name ?? "" }}
          onFinish={(values: { name: string }) => update.mutate({ name: values.name.trim() || null }, { onSuccess: () => setEditing(false) })}
        >
          <Form.Item name="name" noStyle>
            <Input id="account-name" autoFocus className={styles.nameInput} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={update.isPending}>
            Save
          </Button>
          <Button type="link" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </Form>
      </div>
    );
  }

  return (
    <div className={styles.accountRow}>
      <span className={styles.accountLabel}>Name</span>
      {name ? <span>{name}</span> : <span className={styles.empty}>None yet</span>}
      <EditButton label={name ? "Change name" : "Add a name"} adding={!name} onClick={() => setEditing(true)} />
    </div>
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
      <div className={styles.accountRow}>
        <span className={styles.accountLabel}>Default address</span>
        {address ? (
          <span>
            {address.name}, {formatRecipient(address, store.locale)}
          </span>
        ) : (
          <span className={styles.empty}>None yet</span>
        )}
        <EditButton label={address ? "Change default address" : "Add a default address"} adding={!address} onClick={() => setEditing(true)} />
      </div>
    );
  }

  return (
    <div className={styles.accountEdit}>
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
    </div>
  );
}
