import { useId, type ReactNode, type RefObject } from "react";
import { Alert, Button, Input, type InputRef } from "antd";
import { formatRecipient, type Recipient } from "@shared/postcards";
import { describeVerification } from "@/lib/recipients";
import type { RecipientCheck, RecipientErrors } from "@/lib/recipient-form";
import { cx } from "@/lib/cx";
import styles from "./Postcard.module.css";

/**
 * One recipient's address, as a form.
 *
 * Shared by the designer, the account's saved recipients and — later — the
 * public "send me your address" page, so all three refuse the same things
 * (Lob's limits, through `recipientSchema`) and all three run the same
 * verification afterwards: an address USPS knows in a different form is
 * offered back, one it does not know at all is stopped here rather than by
 * the printer after payment.
 */
export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cx(styles.field, styles.grow)}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface RecipientFieldsProps {
  draft: Recipient;
  errors: RecipientErrors;
  onChange: (key: keyof Recipient, value: string) => void;
  nameRef?: RefObject<InputRef | null>;
}

export function RecipientFields({ draft, errors, onChange, nameRef }: RecipientFieldsProps) {
  return (
    <>
      <Field label="Name" error={errors.name}>
        {(id) => <Input id={id} ref={nameRef} value={draft.name} maxLength={40} autoComplete="off" onChange={(e) => onChange("name", e.target.value)} />}
      </Field>
      <Field label="Street address" error={errors.line1}>
        {(id) => <Input id={id} value={draft.line1} maxLength={64} autoComplete="off" onChange={(e) => onChange("line1", e.target.value)} />}
      </Field>
      <Field label="Apt, suite, etc. (optional)" error={errors.line2}>
        {(id) => <Input id={id} value={draft.line2 ?? ""} maxLength={64} autoComplete="off" onChange={(e) => onChange("line2", e.target.value)} />}
      </Field>
      <div className={styles.recipientRow}>
        <Field label="City" error={errors.city}>
          {(id) => <Input id={id} value={draft.city} autoComplete="off" onChange={(e) => onChange("city", e.target.value)} />}
        </Field>
        <Field label="State" error={errors.state}>
          {(id) => <Input id={id} value={draft.state} maxLength={2} placeholder="CA" autoComplete="off" onChange={(e) => onChange("state", e.target.value.toUpperCase())} />}
        </Field>
        <Field label="ZIP" error={errors.postalCode}>
          {(id) => <Input id={id} value={draft.postalCode} maxLength={10} inputMode="numeric" autoComplete="off" onChange={(e) => onChange("postalCode", e.target.value)} />}
        </Field>
      </div>
    </>
  );
}

interface VerificationNoticeProps {
  check: RecipientCheck;
  onUse: () => void;
  onKeep: () => void;
  onDismiss: () => void;
}

/** The card under the form: USPS's form of the address, and what to do about it. */
export function VerificationNotice({ check, onUse, onKeep, onDismiss }: VerificationNoticeProps) {
  const note = describeVerification(check.verification);
  if (!note) return null;
  const suggested = check.verification.changed ? check.verification.suggested : null;

  return (
    <Alert
      className={cx(styles.verificationNotice)}
      type={note.tone === "block" ? "error" : "warning"}
      showIcon
      title={note.title}
      description={
        <div>
          {suggested ? (
            <p className={styles.suggestedAddress}>
              <strong>{suggested.name}</strong>
              <br />
              {formatRecipient(suggested)}
            </p>
          ) : null}
          {note.detail ? <p className={styles.note}>{note.detail}</p> : null}
          <div className={styles.recipientActions}>
            {note.tone === "block" ? (
              <Button size="small" onClick={onDismiss}>
                Check the address
              </Button>
            ) : (
              <>
                {suggested ? (
                  <Button type="primary" size="small" onClick={onUse}>
                    {note.tone === "suggest" ? "Use this" : "Use USPS's form"}
                  </Button>
                ) : null}
                <Button size="small" onClick={onKeep}>
                  Keep mine
                </Button>
                {!suggested ? (
                  <Button size="small" type="text" onClick={onDismiss}>
                    Edit
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      }
    />
  );
}
