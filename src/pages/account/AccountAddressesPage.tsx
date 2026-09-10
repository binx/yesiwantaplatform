import { useEffect, useState } from "react";
import { Alert, Button, Popconfirm, Skeleton } from "antd";
import { formatRecipient, type Recipient } from "@shared/postcards";
import type { AddressInput, CustomerAddress } from "@shared/account";
import { useAddresses, useCreateAddress, useDeleteAddress, useUpdateAddress } from "@/lib/account";
import { cx } from "@/lib/cx";
import { BLANK_RECIPIENT, useRecipientCheck, validateRecipient, type RecipientErrors } from "@/lib/recipient-form";
import { RecipientFields, VerificationNotice } from "@/components/postcard/RecipientFields";
import postcard from "@/components/postcard/Postcard.module.css";
import styles from "./Account.module.css";

/**
 * Saved recipients: the people this customer sends postcards to.
 *
 * Filled in automatically when an order is paid, and editable here. The
 * designer offers this list, so a second batch to the same friends starts
 * from a picker rather than a blank form. The form is the designer's own,
 * verification included: an address saved here has already been through
 * USPS, and the designer does not ask again.
 */
function RecipientForm({
  initial,
  saving,
  error,
  onSave,
  onCancel,
}: {
  initial: Recipient;
  saving: boolean;
  error: string | null;
  onSave: (values: AddressInput) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Recipient>(initial);
  const [errors, setErrors] = useState<RecipientErrors>({});
  const check = useRecipientCheck();

  const set = (key: keyof Recipient, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  return (
    <form
      className={cx(styles.form, postcard.recipientForm)}
      onSubmit={(event) => {
        event.preventDefault();
        const result = validateRecipient(draft);
        if (!result.ok) {
          setErrors(result.errors);
          return;
        }
        void check.run(result.value, (value) => onSave(value));
      }}
    >
      {error ? <Alert className={cx(styles.alert)} type="error" showIcon title={error} /> : null}

      <RecipientFields draft={draft} errors={errors} onChange={set} />

      {check.check ? <VerificationNotice check={check.check} onUse={check.useSuggested} onKeep={check.keepMine} onDismiss={check.dismiss} /> : null}

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
  const create = useCreateAddress();
  const update = useUpdateAddress();
  const remove = useDeleteAddress();
  // "new" is a sentinel for the add form; anything else is a recipient id.
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Recipients · Your account";
  }, []);

  if (addresses.isPending) return <Skeleton active paragraph={{ rows: 4 }} />;

  const list = addresses.data ?? [];

  return (
    <div>
      <p className={cx(styles.meta)}>
        Everyone you have sent a postcard to. They are saved when an order is paid, and the
        designer can pick them again.
      </p>

      {list.length === 0 && editing !== "new" ? (
        <p className={cx(styles.empty)}>No saved recipients yet.</p>
      ) : null}

      {list.map((address) =>
        editing === address.id ? (
          <div key={address.id} className={cx(styles.card)}>
            <RecipientForm
              initial={{ name: address.name, line1: address.line1, line2: address.line2, city: address.city, state: address.state, postalCode: address.postalCode }}
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
            onEdit={() => setEditing(address.id)}
            onDelete={() => remove.mutate(address.id)}
            deleting={remove.isPending}
          />
        ),
      )}

      {editing === "new" ? (
        <div className={cx(styles.card)}>
          <RecipientForm
            initial={BLANK_RECIPIENT}
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
  onEdit,
  onDelete,
  deleting,
}: {
  address: CustomerAddress;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <div className={cx(styles.card)}>
      <div className={cx(styles.cardHeader)}>
        <p className={cx(styles.meta)}>
          <strong>{address.name}</strong>
          {address.verifiedAt ? <span className={cx(styles.default)}>Verified</span> : null}
          <br />
          {formatRecipient(address)}
        </p>
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
