import { useId, useMemo, type ReactNode } from "react";
import { Input, Select } from "antd";
import type { Recipient } from "@shared/postcards";
import { COUNTRY_CODES, countryName } from "@shared/countries";
import { US_STATES } from "@shared/us-states";
import type { RecipientErrors } from "@/lib/recipient-form";
import { cx } from "@/lib/cx";
import styles from "./Postcard.module.css";

/**
 * One mailing address, as a form.
 *
 * Shared by the subscribe flow, the account's address page and the admin's
 * return address, so all three refuse the same things (Lob's limits, through
 * `recipientSchema`). USPS's own check runs on the server when the address
 * is saved, and a refusal comes back as a sentence the form shows.
 */
export function Field({ label, error, children }: { label: string; error?: string | undefined; children: (id: string) => ReactNode }) {
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
  /** For country names. */
  locale: string;
  /** Whether a country other than the US may be chosen. */
  allowInternational: boolean;
}

/**
 * The country comes first when mail may go abroad, because it decides what
 * the rest of the form asks for: a US address needs a two-letter state and
 * a five-digit ZIP; elsewhere the labels loosen and neither is required.
 */
export function RecipientFields({ draft, errors, onChange, locale, allowInternational }: RecipientFieldsProps) {
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
          {(id) => <Select id={id} showSearch value={draft.country} optionFilterProp="label" options={countries} onChange={(value: string) => onChange("country", value)} className={cx(styles.select)} />}
        </Field>
      ) : null}
      <Field label="Name on the card" error={errors.name}>
        {(id) => <Input id={id} value={draft.name} maxLength={40} autoComplete="name" onChange={(e) => onChange("name", e.target.value)} />}
      </Field>
      <Field label="Street address" error={errors.line1}>
        {(id) => <Input id={id} value={draft.line1} maxLength={64} autoComplete="address-line1" onChange={(e) => onChange("line1", e.target.value)} />}
      </Field>
      <Field label="Apt, suite, etc. (optional)" error={errors.line2}>
        {(id) => <Input id={id} value={draft.line2 ?? ""} maxLength={64} autoComplete="address-line2" onChange={(e) => onChange("line2", e.target.value)} />}
      </Field>
      <div className={styles.recipientRow}>
        <Field label="City" error={errors.city}>
          {(id) => <Input id={id} value={draft.city} autoComplete="address-level2" onChange={(e) => onChange("city", e.target.value)} />}
        </Field>
        <Field label={abroad ? "State / province" : "State"} error={errors.state}>
          {(id) =>
            abroad ? (
              <Input id={id} value={draft.state} maxLength={64} autoComplete="address-level1" onChange={(e) => onChange("state", e.target.value)} />
            ) : (
              <Select id={id} showSearch value={draft.state || null} placeholder="Select" optionFilterProp="label" options={states} onChange={(value: string) => onChange("state", value)} className={cx(styles.select)} />
            )
          }
        </Field>
        <Field label={abroad ? "Postal code" : "ZIP"} error={errors.postalCode}>
          {(id) =>
            abroad ? (
              <Input id={id} value={draft.postalCode} maxLength={20} autoComplete="postal-code" onChange={(e) => onChange("postalCode", e.target.value)} />
            ) : (
              <Input id={id} value={draft.postalCode} maxLength={10} inputMode="numeric" autoComplete="postal-code" onChange={(e) => onChange("postalCode", e.target.value)} />
            )
          }
        </Field>
      </div>
    </>
  );
}
