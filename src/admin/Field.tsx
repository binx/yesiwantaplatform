import { useId, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./Field.module.css";

export interface ControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": boolean | undefined;
}

interface FieldProps {
  label: ReactNode;
  /** Guidance. Announced *after* the label, not folded into it. */
  help?: ReactNode;
  /** Shown in place of `help` and marks the control invalid. */
  error?: ReactNode;
  children: (control: ControlProps) => ReactNode;
}

/**
 * A labelled form control.
 *
 * Wrapping an input in a `<label>` associates the two, but the accessible name
 * then becomes the label's entire text content — so "Web address" was being
 * announced as "Web address /product/ Changing this on a live product breaks
 * any link anyone has saved". The name and the guidance are different things
 * and screen readers expose them differently, so they are wired up separately
 * here: `htmlFor` for the name, `aria-describedby` for the rest.
 *
 * v1's inputs had no labels at all (findings 40 and 45), so there was nothing
 * to announce either way.
 */
export function Field({ label, help, error, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : help ? `${id}-help` : undefined;

  return (
    <div className={cx(styles.field)}>
      <label className={cx(styles.label)} htmlFor={id}>
        {label}
      </label>

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}

      {error ? (
        <p className={cx(styles.error)} id={`${id}-error`}>
          {error}
        </p>
      ) : help ? (
        <p className={cx(styles.help)} id={`${id}-help`}>
          {help}
        </p>
      ) : null}
    </div>
  );
}
