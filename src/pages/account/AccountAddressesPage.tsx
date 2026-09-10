import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Checkbox, Input, Popconfirm, Select, Skeleton, Tag } from "antd";
import { formatRecipient, type Recipient } from "@shared/postcards";
import type { AddressInput, CustomerAddress } from "@shared/account";
import { useAddresses, useCreateAddress, useDeleteAddress, useUpdateAddress } from "@/lib/account";
import { addressBookCsv, addressTitle, allTags, filterAddresses, formatBirthday } from "@/lib/address-book";
import { cx } from "@/lib/cx";
import { useStore } from "@/lib/useStore";
import { BLANK_RECIPIENT, useRecipientCheck, validateRecipient, type RecipientErrors } from "@/lib/recipient-form";
import { RecipientFields, VerificationNotice } from "@/components/postcard/RecipientFields";
import postcard from "@/components/postcard/Postcard.module.css";
import styles from "./Account.module.css";

/**
 * The address book: the people this customer sends postcards to.
 *
 * Filled in automatically when an order is paid, and editable here. The
 * designer offers this list, so a second batch to the same friends starts
 * from a picker rather than a blank form. What makes it a book rather than
 * a list: a label ("Mom"), tags for one-click groups ("holiday"), a
 * birthday, notes, when each was last sent to, and a search.
 */
interface Draft {
  recipient: Recipient;
  label: string;
  tags: string[];
  birthday: string;
  knowsYear: boolean;
  notes: string;
}

function toDraft(address: CustomerAddress | null): Draft {
  if (!address) return { recipient: BLANK_RECIPIENT, label: "", tags: [], birthday: "", knowsYear: true, notes: "" };
  const { name, line1, line2, city, state, postalCode, country } = address;
  const knowsYear = address.birthday === null || /^\d{4}-/.test(address.birthday);
  return {
    recipient: { name, line1, line2, city, state, postalCode, country },
    label: address.label ?? "",
    tags: address.tags,
    // A date input wants a full date; a year-less birthday borrows one and drops it again on save.
    birthday: address.birthday === null ? "" : knowsYear ? address.birthday : `2000-${address.birthday}`,
    knowsYear,
    notes: address.notes ?? "",
  };
}

function RecipientForm({
  initial,
  tagOptions,
  saving,
  error,
  onSave,
  onCancel,
}: {
  initial: CustomerAddress | null;
  tagOptions: string[];
  saving: boolean;
  error: string | null;
  onSave: (values: AddressInput) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [errors, setErrors] = useState<RecipientErrors>({});
  const check = useRecipientCheck();
  const store = useStore();

  const set = (key: keyof Recipient, value: string) => {
    setDraft((current) => ({ ...current, recipient: { ...current.recipient, [key]: value } }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  return (
    <form
      className={cx(styles.form, postcard.recipientForm)}
      onSubmit={(event) => {
        event.preventDefault();
        const result = validateRecipient(draft.recipient);
        if (!result.ok) {
          setErrors(result.errors);
          return;
        }
        void check.run(result.value, (value) =>
          onSave({
            ...value,
            label: draft.label.trim() || null,
            tags: draft.tags,
            birthday: draft.birthday === "" ? null : draft.knowsYear ? draft.birthday : draft.birthday.slice(5),
            notes: draft.notes.trim() || null,
          }),
        );
      }}
    >
      {error ? <Alert className={cx(styles.alert)} type="error" showIcon title={error} /> : null}

      <RecipientFields draft={draft.recipient} errors={errors} onChange={set} locale={store.locale} allowInternational={store.internationalPostcardPriceCents !== null} />

      <div className={postcard.field}>
        <label className={postcard.label} htmlFor="address-label">
          What you call them (optional)
        </label>
        <Input id="address-label" value={draft.label} maxLength={80} placeholder="Mom" onChange={(e) => setDraft((c) => ({ ...c, label: e.target.value }))} />
      </div>

      <div className={postcard.field}>
        <label className={postcard.label} htmlFor="address-tags">
          Tags
        </label>
        <Select
          id="address-tags"
          mode="tags"
          value={draft.tags}
          options={tagOptions.map((tag) => ({ value: tag, label: tag }))}
          placeholder="holiday, family"
          tokenSeparators={[","]}
          maxCount={10}
          onChange={(values: string[]) => setDraft((c) => ({ ...c, tags: values.map((v) => v.trim().toLowerCase()).filter(Boolean) }))}
        />
      </div>

      <div className={postcard.recipientRow}>
        <div className={cx(postcard.field, postcard.grow)}>
          <label className={postcard.label} htmlFor="address-birthday">
            Birthday
          </label>
          <input id="address-birthday" className={postcard.dateInput} type="date" value={draft.birthday} onChange={(e) => setDraft((c) => ({ ...c, birthday: e.target.value }))} />
        </div>
        <div className={cx(postcard.field, postcard.grow)}>
          <Checkbox checked={!draft.knowsYear} onChange={(e) => setDraft((c) => ({ ...c, knowsYear: !e.target.checked }))}>
            I don't know the year
          </Checkbox>
        </div>
      </div>

      <div className={postcard.field}>
        <label className={postcard.label} htmlFor="address-notes">
          Notes
        </label>
        <Input.TextArea id="address-notes" value={draft.notes} maxLength={500} autoSize={{ minRows: 2, maxRows: 5 }} onChange={(e) => setDraft((c) => ({ ...c, notes: e.target.value }))} />
      </div>

      {check.check ? <VerificationNotice check={check.check} locale={store.locale} onUse={check.useSuggested} onKeep={check.keepMine} onDismiss={check.dismiss} /> : null}

      <div className={postcard.recipientActions}>
        <Button type="primary" htmlType="submit" loading={saving || check.verifying}>
          Save recipient
        </Button>
        <Button onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function AccountAddressesPage() {
  const addresses = useAddresses();
  const store = useStore();
  const create = useCreateAddress();
  const update = useUpdateAddress();
  const remove = useDeleteAddress();
  // "new" is a sentinel for the add form; anything else is a recipient id.
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    document.title = "Recipients · Your account";
  }, []);

  const list = useMemo(() => addresses.data ?? [], [addresses.data]);
  const tagOptions = useMemo(() => allTags(list), [list]);
  const shown = useMemo(() => filterAddresses(list, query, tags), [list, query, tags]);

  if (addresses.isPending) return <Skeleton active paragraph={{ rows: 4 }} />;

  return (
    <div>
      <p className={cx(styles.meta)}>
        Everyone you have sent a postcard to. They are saved when an order is paid, and the
        designer can pick them again — one tag at a time, if you like.
      </p>

      {list.length > 0 ? (
        <div className={cx(styles.bookTools)}>
          <Input.Search allowClear placeholder="Search by name, city or tag" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search recipients" className={cx(styles.search)} />
          {tagOptions.length > 0 ? (
            <div className={cx(styles.tagRow)} role="group" aria-label="Filter by tag">
              {tagOptions.map((tag) => (
                <Tag.CheckableTag key={tag} checked={tags.includes(tag)} onChange={(on) => setTags((current) => (on ? [...current, tag] : current.filter((t) => t !== tag)))}>
                  {tag}
                </Tag.CheckableTag>
              ))}
            </div>
          ) : null}
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(addressBookCsv(list))}`} download="recipients.csv">
            <Button size="small">Export CSV</Button>
          </a>
        </div>
      ) : null}

      {list.length === 0 && editing !== "new" ? <p className={cx(styles.empty)}>No saved recipients yet.</p> : null}
      {list.length > 0 && shown.length === 0 ? <p className={cx(styles.empty)}>Nobody matches that.</p> : null}

      {shown.map((address) =>
        editing === address.id ? (
          <div key={address.id} className={cx(styles.card)}>
            <RecipientForm
              initial={address}
              tagOptions={tagOptions}
              saving={update.isPending}
              error={update.error instanceof Error ? update.error.message : null}
              onCancel={() => setEditing(null)}
              onSave={(input) => update.mutate({ id: address.id, input }, { onSuccess: () => setEditing(null) })}
            />
          </div>
        ) : (
          <RecipientCard
            key={address.id}
            address={address}
            locale={store.locale}
            onEdit={() => setEditing(address.id)}
            onDelete={() => remove.mutate(address.id)}
            deleting={remove.isPending}
          />
        ),
      )}

      {editing === "new" ? (
        <div className={cx(styles.card)}>
          <RecipientForm
            initial={null}
            tagOptions={tagOptions}
            saving={create.isPending}
            error={create.error instanceof Error ? create.error.message : null}
            onCancel={() => setEditing(null)}
            onSave={(input) => create.mutate(input, { onSuccess: () => setEditing(null) })}
          />
        </div>
      ) : (
        <Button onClick={() => setEditing("new")}>Add a recipient</Button>
      )}
    </div>
  );
}

function RecipientCard({
  address,
  locale,
  onEdit,
  onDelete,
  deleting,
}: {
  address: CustomerAddress;
  locale: string;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const facts: string[] = [];
  if (address.lastSentAt) facts.push(`Last sent ${new Date(address.lastSentAt).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}`);
  if (address.birthday) facts.push(`Birthday ${formatBirthday(address.birthday, locale)}`);

  return (
    <div className={cx(styles.card)}>
      <div className={cx(styles.cardHeader)}>
        <div>
          <p className={cx(styles.meta)}>
            <strong>{addressTitle(address)}</strong>
            {address.verifiedAt ? <span className={cx(styles.default)}>Verified</span> : null}
            {address.source === "request" ? <span className={cx(styles.default)}>via your link</span> : null}
            <br />
            {formatRecipient(address, locale)}
          </p>
          {facts.length > 0 || address.tags.length > 0 ? (
            <p className={cx(styles.meta, styles.facts)}>
              {facts.join(" · ")}
              {address.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </p>
          ) : null}
          {address.notes ? <p className={cx(styles.meta)}>{address.notes}</p> : null}
        </div>
        <div className={cx(styles.cardActions)}>
          <Button size="small" onClick={onEdit}>
            Edit
          </Button>
          <Popconfirm title="Remove this recipient?" onConfirm={onDelete}>
            <Button size="small" danger loading={deleting}>
              Remove
            </Button>
          </Popconfirm>
        </div>
      </div>
    </div>
  );
}
