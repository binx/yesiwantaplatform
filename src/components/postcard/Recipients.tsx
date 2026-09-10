import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Checkbox, Input, Modal, Tag, type InputRef } from "antd";
import { DeleteOutlined, EditOutlined, UploadOutlined } from "@ant-design/icons";
import { formatRecipient, isInternational, type Recipient, type Verification } from "@shared/postcards";
import type { CustomerAddress } from "@shared/account";
import { useAddresses, useCustomer } from "@/lib/account";
import { useStore } from "@/lib/useStore";
import { parseRecipientsCsv, SAMPLE_CSV, type CsvProblem, type CsvResult } from "@/lib/recipients-csv";
import { describeVerification, recipientKey, verifyRecipient } from "@/lib/recipients";
import { addressTitle, allTags, filterAddresses } from "@/lib/address-book";
import { cx } from "@/lib/cx";
import { BLANK_RECIPIENT, useRecipientCheck, validateRecipient, type RecipientErrors } from "@/lib/recipient-form";
import { RecipientFields, VerificationNotice } from "./RecipientFields";
import styles from "./Postcard.module.css";

/**
 * Who gets the cards.
 *
 * Three ways in: a form, a CSV, and — for a signed-in customer — the people
 * they have written to before. Every one of them ends in `recipientSchema`,
 * which carries Lob's limits, so a name that will not fit on the card is
 * refused here and not by the printer after the money has been taken.
 *
 * Then USPS gets a say. Each address is verified through Lob as it arrives:
 * the form asks before adding, a list is checked a few at a time after, and
 * an address USPS does not know at all keeps the batch out of the cart
 * until it is fixed or removed — because Lob would refuse it after payment,
 * and that is the worse place to find out.
 */
interface RecipientsProps {
  recipients: Recipient[];
  onChange: (recipients: Recipient[]) => void;
  /** How many recipients USPS refused; the page keeps the batch out of the cart while it is above zero. */
  onBlockedChange?: (count: number) => void;
}

const VERIFIED: Verification = { deliverability: "deliverable", suggested: null, changed: false };

export function Recipients({ recipients, onChange, onBlockedChange }: RecipientsProps) {
  const [draft, setDraft] = useState<Recipient>(BLANK_RECIPIENT);
  const [errors, setErrors] = useState<RecipientErrors>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  // Rows a CSV could not use, kept here so the good rows go in and these get fixed one by one.
  const [pending, setPending] = useState<CsvProblem[]>([]);
  const [fixingLine, setFixingLine] = useState<number | null>(null);
  // What USPS said about each recipient in the list, by `recipientKey`.
  const [verified, setVerified] = useState<Record<string, Verification>>({});
  const [reviewing, setReviewing] = useState<number | null>(null);
  const inFlight = useRef(new Set<string>());
  const nameRef = useRef<InputRef>(null);
  const customer = useCustomer();
  const store = useStore();
  const check = useRecipientCheck();

  const set = (key: keyof Recipient, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const mark = (entries: [string, Verification][]) =>
    setVerified((current) => ({ ...current, ...Object.fromEntries(entries) }));

  const commit = (value: Recipient, verification: Verification) => {
    if (editing === null) onChange([...recipients, value]);
    else onChange(recipients.map((r, i) => (i === editing ? value : r)));
    mark([[recipientKey(value), verification]]);

    if (fixingLine !== null) setPending((current) => current.filter((problem) => problem.line !== fixingLine));
    setFixingLine(null);
    setDraft(BLANK_RECIPIENT);
    setErrors({});
    setEditing(null);
    nameRef.current?.focus();
  };

  const submit = () => {
    const result = validateRecipient(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    void check.run(result.value, commit);
  };

  const importCsv = (list: Recipient[], problems: CsvProblem[]) => {
    onChange([...recipients, ...list]);
    setPending(problems);
    setFixingLine(null);
  };

  /** Load a row the CSV could not use into the form, with its errors showing, so the fix is one field away. */
  const fix = (problem: CsvProblem) => {
    const result = validateRecipient(problem.draft);
    setDraft(problem.draft);
    setErrors(result.ok ? {} : result.errors);
    setEditing(null);
    setFixingLine(problem.line);
    nameRef.current?.focus();
  };

  const edit = (index: number) => {
    setDraft(recipients[index] ?? BLANK_RECIPIENT);
    setEditing(index);
    setErrors({});
    setReviewing(null);
    check.dismiss();
    nameRef.current?.focus();
  };

  const remove = (index: number) => {
    onChange(recipients.filter((_, i) => i !== index));
    if (editing === index) {
      setEditing(null);
      setDraft(BLANK_RECIPIENT);
    }
    if (reviewing === index) setReviewing(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setFixingLine(null);
    setDraft(BLANK_RECIPIENT);
    setErrors({});
    check.dismiss();
  };

  // Addresses that arrived without passing through the form — a CSV, the
  // saved list — are verified a few at a time, and the results land as chips.
  useEffect(() => {
    const queue = recipients.filter((recipient) => {
      const key = recipientKey(recipient);
      return !(key in verified) && !inFlight.current.has(key);
    });
    if (queue.length === 0) return;

    const batch = queue.slice(0, 4);
    for (const recipient of batch) inFlight.current.add(recipientKey(recipient));
    void Promise.all(batch.map(async (recipient) => [recipientKey(recipient), await verifyRecipient(recipient)] as const)).then((results) => {
      for (const [key] of results) inFlight.current.delete(key);
      mark(results.map(([key, verification]) => [key, verification]));
    });
  }, [recipients, verified]);

  const statusOf = (recipient: Recipient) => verified[recipientKey(recipient)];
  const blocked = recipients.filter((recipient) => statusOf(recipient)?.deliverability === "undeliverable").length;
  const suggestions = recipients.filter((recipient) => {
    const status = statusOf(recipient);
    return status?.deliverability === "deliverable" && status.changed && status.suggested;
  }).length;

  useEffect(() => {
    onBlockedChange?.(blocked);
  }, [blocked, onBlockedChange]);

  const applyAllSuggestions = () => {
    const entries: [string, Verification][] = [];
    const next = recipients.map((recipient) => {
      const status = statusOf(recipient);
      if (status?.deliverability === "deliverable" && status.changed && status.suggested) {
        entries.push([recipientKey(status.suggested), VERIFIED]);
        return status.suggested;
      }
      return recipient;
    });
    mark(entries);
    onChange(next);
  };

  const reviewed = reviewing !== null ? recipients[reviewing] : undefined;
  const reviewedStatus = reviewed ? statusOf(reviewed) : undefined;

  return (
    <div className={styles.recipients}>
      <form
        className={cx(styles.recipientForm)}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <RecipientFields draft={draft} errors={errors} onChange={set} nameRef={nameRef} locale={store.locale} allowInternational={store.internationalPostcardPriceCents !== null} />
        <div className={styles.recipientActions}>
          <Button type="primary" htmlType="submit" loading={check.verifying}>
            {editing === null ? "Add recipient" : "Save changes"}
          </Button>
          {editing !== null || fixingLine !== null ? <Button onClick={cancelEdit}>Cancel</Button> : null}
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
        {check.check ? <VerificationNotice check={check.check} locale={store.locale} onUse={check.useSuggested} onKeep={check.keepMine} onDismiss={check.dismiss} /> : null}
      </form>

      <ol className={styles.recipientList} aria-label="Recipients">
        {recipients.map((recipient, index) => {
          const status = statusOf(recipient);
          const note = status ? describeVerification(status) : null;
          return (
            <li key={`${index}-${recipient.name}`} className={styles.recipientItem}>
              <span className={styles.badge}>{index + 1}</span>
              <span className={styles.recipientText}>
                <strong>{recipient.name}</strong>
                <span>{formatRecipient(recipient, store.locale)}</span>
                {status?.deliverability === "deliverable" && !status.changed ? (
                  <span className={styles.verifiedChip}>Verified</span>
                ) : note?.tone === "suggest" || note?.tone === "warn" ? (
                  <Button size="small" className={cx(styles.chipButton)} onClick={() => setReviewing(index)} aria-label={`Review ${recipient.name}`}>
                    {note.tone === "suggest" ? "Suggested" : "Check"}
                  </Button>
                ) : note?.tone === "block" ? (
                  <Button size="small" danger className={cx(styles.chipButton)} onClick={() => edit(index)} aria-label={`Fix ${recipient.name}`}>
                    Check this
                  </Button>
                ) : null}
                {reviewing === index && reviewed && reviewedStatus ? (
                  <VerificationNotice
                    check={{ value: reviewed, verification: reviewedStatus }}
                    locale={store.locale}
                    onUse={() => {
                      const suggested = reviewedStatus.suggested ?? reviewed;
                      onChange(recipients.map((r, i) => (i === index ? suggested : r)));
                      mark([[recipientKey(suggested), VERIFIED]]);
                      setReviewing(null);
                    }}
                    onKeep={() => {
                      mark([[recipientKey(reviewed), VERIFIED]]);
                      setReviewing(null);
                    }}
                    onDismiss={() => {
                      setReviewing(null);
                      if (reviewedStatus.deliverability !== "deliverable") edit(index);
                    }}
                  />
                ) : null}
              </span>
              <Button type="text" size="small" icon={<EditOutlined />} aria-label={`Edit ${recipient.name}`} onClick={() => edit(index)} />
              <Button type="text" size="small" icon={<DeleteOutlined />} aria-label={`Remove ${recipient.name}`} onClick={() => remove(index)} />
            </li>
          );
        })}
      </ol>

      {recipients.some(isInternational) ? (
        <p className={styles.note}>International cards take about two weeks longer to arrive.</p>
      ) : null}

      {suggestions > 1 ? (
        <p className={styles.recipientActions}>
          <Button size="small" onClick={applyAllSuggestions}>
            Use USPS's form for all {suggestions}
          </Button>
        </p>
      ) : null}

      {blocked > 0 ? (
        <Alert
          type="error"
          showIcon
          title={`${blocked} address${blocked === 1 ? "" : "es"} need${blocked === 1 ? "s" : ""} checking`}
          description="USPS doesn't recognise them. Fix or remove them before adding this batch to the cart."
        />
      ) : null}

      {pending.length > 0 ? (
        <div className={styles.pendingRows} role="region" aria-label="Rows that need fixing">
          <strong>
            {pending.length} row{pending.length === 1 ? "" : "s"} from your file need{pending.length === 1 ? "s" : ""} fixing
          </strong>
          <ul>
            {pending.map((problem) => (
              <li key={problem.line}>
                <span>
                  Line {problem.line}: {problem.message}
                </span>
                <Button size="small" onClick={() => fix(problem)} aria-label={`Fix line ${problem.line}`}>
                  Edit
                </Button>
                <Button
                  size="small"
                  type="text"
                  aria-label={`Skip line ${problem.line}`}
                  onClick={() => setPending((current) => current.filter((p) => p.line !== problem.line))}
                >
                  Skip
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <CsvModal open={csvOpen} onClose={() => setCsvOpen(false)} onImport={importCsv} />
      {customer.data ? (
        <SavedRecipientsModal
          open={savedOpen}
          onClose={() => setSavedOpen(false)}
          existing={recipients}
          onAdd={(list) => {
            // Ones Lob already called deliverable are not asked about again.
            mark(list.filter((address) => address.verifiedAt !== null).map((address) => [recipientKey(address), VERIFIED]));
            onChange([...recipients, ...list.map(({ name, line1, line2, city, state, postalCode, country }) => ({ name, line1, line2, city, state, postalCode, country }))]);
          }}
        />
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------- CSV */

/**
 * Two steps: read the file, then show what was made of it — which column fed
 * which field, the first rows as parsed, how many rows failed — before
 * anything is added. That one screen is what catches a "City" column that
 * was really the state, which would otherwise print two hundred cards wrong.
 */
function CsvModal({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (recipients: Recipient[], problems: CsvProblem[]) => void;
}) {
  const [result, setResult] = useState<CsvResult | null>(null);
  const [fileName, setFileName] = useState("");
  const inputId = useId();

  useEffect(() => {
    if (!open) {
      setResult(null);
      setFileName("");
    }
  }, [open]);

  const read = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setResult(parseRecipientsCsv(await file.text()));
  };

  // A problem on line 1 is about the file's shape, not a row: nothing was read.
  const fatal = result !== null && result.recipients.length === 0 && result.problems.some((problem) => problem.line === 1);
  const good = result?.recipients.length ?? 0;
  const bad = result?.problems.length ?? 0;

  return (
    <Modal title="Upload a list of recipients" open={open} onCancel={onClose} footer={null}>
      <p>
        Format your list as a CSV with the columns in the sample. Every address needs a name, a
        street, a city, a two-letter state and a 5-digit ZIP. Column names like "Street Address"
        or "Zip Code" are fine too.
      </p>
      <p className={styles.recipientActions}>
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_CSV)}`} download="sample_recipients.csv">
          <Button>Download the sample CSV</Button>
        </a>
        <label htmlFor={inputId}>
          <input id={inputId} className={styles.fileInput} type="file" accept=".csv,text/csv" onChange={(event) => void read(event.target.files?.[0])} />
          <Button type="primary" icon={<UploadOutlined />} onClick={() => document.getElementById(inputId)?.click()}>
            {result ? "Choose a different CSV" : "Choose a CSV"}
          </Button>
        </label>
      </p>

      {result && fatal ? <Alert type="error" showIcon title={result.problems[0]?.message} /> : null}

      {result && !fatal ? (
        <div role="status" aria-label="What was read from the file">
          <p>
            <strong>{fileName}</strong>: {good} recipient{good === 1 ? "" : "s"} read
            {bad > 0 ? `, ${bad} row${bad === 1 ? "" : "s"} need${bad === 1 ? "s" : ""} fixing` : ""}.
          </p>
          <ul className={styles.csvMapping}>
            {result.mapping.map((column) => (
              <li key={column.header}>
                We read <em>{column.header}</em> as {column.label}.
              </li>
            ))}
            {result.ignored.length > 0 ? <li>Ignored: {result.ignored.join(", ")}.</li> : null}
          </ul>
          {result.preview.length > 0 ? (
            <table className={styles.csvPreview}>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Address</th>
                </tr>
              </thead>
              <tbody>
                {result.preview.map((recipient, index) => (
                  <tr key={index}>
                    <td>{recipient.name}</td>
                    <td>{formatRecipient(recipient)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <div className={styles.csvActions}>
            <Button
              type="primary"
              disabled={good === 0 && bad === 0}
              onClick={() => {
                onImport(result.recipients, result.problems);
                onClose();
              }}
            >
              {good > 0 ? `Import ${good} recipient${good === 1 ? "" : "s"}` : "Fix the rows by hand"}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

/* ------------------------------------------------------------- saved list */

function SavedRecipientsModal({
  open,
  onClose,
  existing,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  existing: Recipient[];
  onAdd: (addresses: CustomerAddress[]) => void;
}) {
  const addresses = useAddresses(open);
  const store = useStore();
  const [chosen, setChosen] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const already = new Set(existing.map(recipientKey));

  const available = (addresses.data ?? []).filter((address) => !already.has(recipientKey(address)));
  const tagOptions = allTags(available);
  const list = filterAddresses(available, query, tags);

  return (
    <Modal
      title="Saved recipients"
      open={open}
      onCancel={onClose}
      okText={`Add ${chosen.length || ""}`.trim()}
      okButtonProps={{ disabled: chosen.length === 0 }}
      onOk={() => {
        onAdd(available.filter((address) => chosen.includes(address.id)));
        setChosen([]);
        onClose();
      }}
    >
      {addresses.isPending ? (
        <p>Loading…</p>
      ) : available.length === 0 ? (
        <p>
          Everyone you have saved is already on this list, or you have not saved anyone yet. The
          people you send to are saved when an order is paid.
        </p>
      ) : (
        <>
          <div className={styles.savedTools}>
            <Input allowClear placeholder="Search" value={query} aria-label="Search saved recipients" onChange={(e) => setQuery(e.target.value)} />
            {tagOptions.length > 0 ? (
              <div className={styles.savedTags} role="group" aria-label="Filter by tag">
                {tagOptions.map((tag) => (
                  <Tag.CheckableTag key={tag} checked={tags.includes(tag)} onChange={(on) => setTags((current) => (on ? [...current, tag] : current.filter((t) => t !== tag)))}>
                    {tag}
                  </Tag.CheckableTag>
                ))}
              </div>
            ) : null}
            <Button size="small" disabled={list.length === 0} onClick={() => setChosen((current) => [...new Set([...current, ...list.map((a) => a.id)])])}>
              Select all shown{tags.length > 0 || query ? ` (${list.length})` : ""}
            </Button>
          </div>
          {list.length === 0 ? (
            <p className={styles.note}>Nobody matches that.</p>
          ) : (
            <Checkbox.Group
              className={cx(styles.savedList)}
              value={chosen}
              onChange={(values) => setChosen(values)}
              options={list.map((address) => ({
                value: address.id,
                label: (
                  <span className={styles.recipientText}>
                    <strong>{addressTitle(address)}</strong>
                    <span>{formatRecipient(address, store.locale)}</span>
                    {address.lastSentAt ? (
                      <span className={styles.note}>Last sent {new Date(address.lastSentAt).toLocaleDateString(store.locale, { month: "short", year: "numeric" })}</span>
                    ) : null}
                  </span>
                ),
              }))}
            />
          )}
        </>
      )}
    </Modal>
  );
}
