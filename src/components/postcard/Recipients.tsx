import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Checkbox, Input, Modal, type InputRef } from "antd";
import { DeleteOutlined, EditOutlined, UploadOutlined } from "@ant-design/icons";
import { formatRecipient, recipientSchema, type Recipient } from "@shared/postcards";
import { useAddresses, useCustomer } from "@/lib/account";
import { parseRecipientsCsv, SAMPLE_CSV, type CsvProblem } from "@/lib/recipients-csv";
import { cx } from "@/lib/cx";
import styles from "./Postcard.module.css";

/**
 * Who gets the cards.
 *
 * Three ways in: a form, a CSV, and — for a signed-in customer — the people
 * they have written to before. Every one of them ends in `recipientSchema`,
 * which carries Lob's limits, so a name that will not fit on the card is
 * refused here and not by the printer after the money has been taken.
 */
interface RecipientsProps {
  recipients: Recipient[];
  onChange: (recipients: Recipient[]) => void;
}

const BLANK: Recipient = { name: "", line1: "", line2: null, city: "", state: "", postalCode: "" };

type Errors = Partial<Record<keyof Recipient, string>>;

function validate(draft: Recipient): { ok: true; value: Recipient } | { ok: false; errors: Errors } {
  const parsed = recipientSchema.safeParse({ ...draft, line2: draft.line2?.trim() ? draft.line2 : null });
  if (parsed.success) return { ok: true, value: parsed.data };

  const errors: Errors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof Recipient | undefined;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}

export function Recipients({ recipients, onChange }: RecipientsProps) {
  const [draft, setDraft] = useState<Recipient>(BLANK);
  const [errors, setErrors] = useState<Errors>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const nameRef = useRef<InputRef>(null);
  const customer = useCustomer();

  const set = (key: keyof Recipient, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = () => {
    const result = validate(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }

    if (editing === null) onChange([...recipients, result.value]);
    else onChange(recipients.map((r, i) => (i === editing ? result.value : r)));

    setDraft(BLANK);
    setErrors({});
    setEditing(null);
    nameRef.current?.focus();
  };

  const edit = (index: number) => {
    setDraft(recipients[index] ?? BLANK);
    setEditing(index);
    setErrors({});
    nameRef.current?.focus();
  };

  const remove = (index: number) => {
    onChange(recipients.filter((_, i) => i !== index));
    if (editing === index) {
      setEditing(null);
      setDraft(BLANK);
    }
  };

  return (
    <div className={styles.recipients}>
      <form
        className={cx(styles.recipientForm)}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label="Name" error={errors.name}>
          {(id) => (
            <Input id={id} ref={nameRef} value={draft.name} maxLength={40} autoComplete="off" onChange={(e) => set("name", e.target.value)} />
          )}
        </Field>
        <Field label="Street address" error={errors.line1}>
          {(id) => <Input id={id} value={draft.line1} maxLength={64} autoComplete="off" onChange={(e) => set("line1", e.target.value)} />}
        </Field>
        <Field label="Apt, suite, etc. (optional)" error={errors.line2}>
          {(id) => <Input id={id} value={draft.line2 ?? ""} maxLength={64} autoComplete="off" onChange={(e) => set("line2", e.target.value)} />}
        </Field>
        <div className={styles.recipientRow}>
          <Field label="City" error={errors.city}>
            {(id) => <Input id={id} value={draft.city} autoComplete="off" onChange={(e) => set("city", e.target.value)} />}
          </Field>
          <Field label="State" error={errors.state}>
            {(id) => <Input id={id} value={draft.state} maxLength={2} placeholder="CA" autoComplete="off" onChange={(e) => set("state", e.target.value.toUpperCase())} />}
          </Field>
          <Field label="ZIP" error={errors.postalCode}>
            {(id) => <Input id={id} value={draft.postalCode} maxLength={10} inputMode="numeric" autoComplete="off" onChange={(e) => set("postalCode", e.target.value)} />}
          </Field>
        </div>
        <div className={styles.recipientActions}>
          <Button type="primary" htmlType="submit">
            {editing === null ? "Add recipient" : "Save changes"}
          </Button>
          {editing !== null ? (
            <Button
              onClick={() => {
                setEditing(null);
                setDraft(BLANK);
                setErrors({});
              }}
            >
              Cancel
            </Button>
          ) : null}
          <Button icon={<UploadOutlined />} onClick={() => setCsvOpen(true)}>
            Upload a list
          </Button>
          {customer.data ? (
            <Button onClick={() => setSavedOpen(true)}>Saved recipients</Button>
          ) : (
            <span className={styles.note}>
              <Link to="/account/login" state={{ from: "/create" }}>
                Sign in
              </Link>{" "}
              to reuse the people you have sent to before.
            </span>
          )}
        </div>
      </form>

      <ol className={styles.recipientList} aria-label="Recipients">
        {recipients.map((recipient, index) => (
          <li key={`${index}-${recipient.name}`} className={styles.recipientItem}>
            <span className={styles.badge}>{index + 1}</span>
            <span className={styles.recipientText}>
              <strong>{recipient.name}</strong>
              <span>{formatRecipient(recipient)}</span>
            </span>
            <Button type="text" size="small" icon={<EditOutlined />} aria-label={`Edit ${recipient.name}`} onClick={() => edit(index)} />
            <Button type="text" size="small" icon={<DeleteOutlined />} aria-label={`Remove ${recipient.name}`} onClick={() => remove(index)} />
          </li>
        ))}
      </ol>

      <CsvModal open={csvOpen} onClose={() => setCsvOpen(false)} onImport={(list) => onChange([...recipients, ...list])} />
      {customer.data ? (
        <SavedRecipientsModal
          open={savedOpen}
          onClose={() => setSavedOpen(false)}
          existing={recipients}
          onAdd={(list) => onChange([...recipients, ...list])}
        />
      ) : null}
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: (id: string) => React.ReactNode;
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

/* ---------------------------------------------------------------------- CSV */

function CsvModal({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (recipients: Recipient[]) => void;
}) {
  const [problems, setProblems] = useState<CsvProblem[]>([]);
  const [imported, setImported] = useState<number | null>(null);
  const inputId = useId();

  useEffect(() => {
    if (!open) {
      setProblems([]);
      setImported(null);
    }
  }, [open]);

  const read = async (file: File | undefined) => {
    if (!file) return;
    const { recipients, problems: found } = parseRecipientsCsv(await file.text());
    setProblems(found);
    if (found.length === 0 && recipients.length > 0) {
      onImport(recipients);
      setImported(recipients.length);
    }
  };

  return (
    <Modal title="Upload a list of recipients" open={open} onCancel={onClose} footer={null}>
      <p>
        Format your list as a CSV with the columns in the sample. Every address needs a name, a
        street, a city, a two-letter state and a 5-digit ZIP.
      </p>
      <p className={styles.recipientActions}>
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_CSV)}`} download="sample_recipients.csv">
          <Button>Download the sample CSV</Button>
        </a>
        <label htmlFor={inputId}>
          <input id={inputId} className={styles.fileInput} type="file" accept=".csv,text/csv" onChange={(event) => void read(event.target.files?.[0])} />
          <Button type="primary" icon={<UploadOutlined />} onClick={() => document.getElementById(inputId)?.click()}>
            Choose a CSV
          </Button>
        </label>
      </p>

      {imported !== null ? (
        <Alert type="success" showIcon title={`Added ${imported} recipient${imported === 1 ? "" : "s"}.`} />
      ) : null}

      {problems.length > 0 ? (
        <Alert
          type="error"
          showIcon
          title="Some rows need fixing before the list can be used"
          description={
            <ul className={styles.problemList}>
              {problems.slice(0, 20).map((problem) => (
                <li key={`${problem.line}-${problem.message}`}>
                  Line {problem.line}: {problem.message}
                </li>
              ))}
              {problems.length > 20 ? <li>…and {problems.length - 20} more.</li> : null}
            </ul>
          }
        />
      ) : null}
    </Modal>
  );
}

/* ------------------------------------------------------------- saved list */

const key = (r: Recipient) => `${r.name}|${formatRecipient(r)}`.toLowerCase();

function SavedRecipientsModal({
  open,
  onClose,
  existing,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  existing: Recipient[];
  onAdd: (recipients: Recipient[]) => void;
}) {
  const addresses = useAddresses(open);
  const [chosen, setChosen] = useState<string[]>([]);
  const already = new Set(existing.map(key));

  const list = (addresses.data ?? []).filter((address) => !already.has(key(address)));

  return (
    <Modal
      title="Saved recipients"
      open={open}
      onCancel={onClose}
      okText={`Add ${chosen.length || ""}`.trim()}
      okButtonProps={{ disabled: chosen.length === 0 }}
      onOk={() => {
        const picked = list.filter((address) => chosen.includes(address.id));
        onAdd(picked.map(({ name, line1, line2, city, state, postalCode }) => ({ name, line1, line2, city, state, postalCode })));
        setChosen([]);
        onClose();
      }}
    >
      {addresses.isPending ? (
        <p>Loading…</p>
      ) : list.length === 0 ? (
        <p>
          Everyone you have saved is already on this list, or you have not saved anyone yet. The
          people you send to are saved when an order is paid.
        </p>
      ) : (
        <Checkbox.Group
          className={cx(styles.savedList)}
          value={chosen}
          onChange={(values) => setChosen(values)}
          options={list.map((address) => ({
            value: address.id,
            label: (
              <span className={styles.recipientText}>
                <strong>{address.name}</strong>
                <span>{formatRecipient(address)}</span>
              </span>
            ),
          }))}
        />
      )}
    </Modal>
  );
}
