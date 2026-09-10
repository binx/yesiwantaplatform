import { useId, useMemo, type ReactNode, type RefObject } from "react";
import { Alert, Button, Input, Select, type InputRef } from "antd";
import { formatRecipient, type Recipient } from "@shared/postcards";
import { COUNTRY_CODES, countryName } from "@shared/countries";
import { US_STATES } from "@shared/us-states";
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
  line1Ref?: RefObject<InputRef | null>;
  /** For country names and the address line. */
  locale: string;
  /** Whether a country other than the US may be chosen: the shop has an international price, and this is not its own return address. */
  allowInternational: boolean;
}

/**
 * The country comes first when the shop mails abroad, because it decides
 * what the rest of the form asks for: a US address needs a two-letter state
 * and a five-digit ZIP; elsewhere the labels loosen and neither is required.
 * A shop with no international price never shows the select at all.
 */
export function RecipientFields({ draft, errors, onChange, nameRef, line1Ref, locale, allowInternational }: RecipientFieldsProps) {
  const abroad = draft.country !== "US";
  const countries = useMemo(
    () =>
      COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code, locale) })).sort((a, b) =>
        a.value === "US" ? -1 : b.value === "US" ? 1 : a.label.localeCompare(b.label, locale),
      ),
    [locale],
  );
  const states = useMemo(() => US_STATES.map((state) => ({ value: state.code, label: `${state.code} · ${state.name}` })), []);

  return (
    <>
      {allowInternational ? (
        <Field label="Country" error={errors.country}>
          {(id) => (
            <Select
              id={id}
              showSearch
              value={draft.country}
              optionFilterProp="label"
              options={countries}
              onChange={(value: string) => onChange("country", value)}
              className={cx(styles.countrySelect)}
            />
          )}
        </Field>
      ) : null}
      <Field label="Name" error={errors.name}>
        {(id) => <Input id={id} ref={nameRef} value={draft.name} maxLength={40} autoComplete="off" onChange={(e) => onChange("name", e.target.value)} />}
      </Field>
      <Field label="Street address" error={errors.line1}>
        {(id) => <Input id={id} ref={line1Ref} value={draft.line1} maxLength={64} autoComplete="off" onChange={(e) => onChange("line1", e.target.value)} />}
      </Field>
      <Field label="Apt, suite, etc. (optional)" error={errors.line2}>
        {(id) => <Input id={id} value={draft.line2 ?? ""} maxLength={64} autoComplete="off" onChange={(e) => onChange("line2", e.target.value)} />}
      </Field>
      <div className={styles.recipientRow}>
        <Field label="City" error={errors.city}>
          {(id) => <Input id={id} value={draft.city} autoComplete="off" onChange={(e) => onChange("city", e.target.value)} />}
        </Field>
        <Field label={abroad ? "State / province" : "State"} error={errors.state}>
          {(id) =>
            abroad ? (
              <Input id={id} value={draft.state} maxLength={64} autoComplete="off" onChange={(e) => onChange("state", e.target.value)} />
            ) : (
              <Select id={id} showSearch value={draft.state || null} placeholder="Choose a state" optionFilterProp="label" options={states} onChange={(value: string) => onChange("state", value)} />
            )
          }
        </Field>
        <Field label={abroad ? "Postal code" : "ZIP"} error={errors.postalCode}>
          {(id) =>
            abroad ? (
              <Input id={id} value={draft.postalCode} maxLength={20} autoComplete="off" onChange={(e) => onChange("postalCode", e.target.value)} />
            ) : (
              <Input id={id} value={draft.postalCode} maxLength={10} inputMode="numeric" autoComplete="off" onChange={(e) => onChange("postalCode", e.target.value)} />
            )
          }
        </Field>
      </div>
    </>
  );
}

interface VerificationNoticeProps {
  check: RecipientCheck;
  locale: string;
  onUse: () => void;
  onKeep: () => void;
  onDismiss: () => void;
  onEdit: () => void;
}

/** The card under the form: USPS's form of the address, and what to do about it. */
export function VerificationNotice({ check, locale, onUse, onKeep, onDismiss, onEdit }: VerificationNoticeProps) {
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
              {formatRecipient(suggested, locale)}
            </p>
          ) : null}
          {note.detail ? <p className={styles.note}>{note.detail}</p> : null}
          <div className={styles.recipientActions}>
            {note.tone === "block" ? (
              <Button size="small" onClick={onEdit}>
                Edit the address
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
