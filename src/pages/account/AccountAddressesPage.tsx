import { useEffect, useState } from "react";
import { Alert, Button, Form, Input, Popconfirm, Skeleton } from "antd";
import { formatRecipient } from "@shared/postcards";
import type { AddressInput, CustomerAddress } from "@shared/account";
import { useAddresses, useCreateAddress, useDeleteAddress, useUpdateAddress } from "@/lib/account";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

/**
 * Saved recipients: the people this customer sends postcards to.
 *
 * Filled in automatically when an order is paid, and editable here. The
 * designer offers this list, so a second batch to the same friends starts
 * from a picker rather than a blank form.
 */
interface RecipientFormValues {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
}

const BLANK: RecipientFormValues = { name: "", line1: "", line2: "", city: "", state: "", postalCode: "" };

function RecipientForm({
  initial,
  saving,
  error,
  onSave,
  onCancel,
}: {
  initial: RecipientFormValues;
  saving: boolean;
  error: string | null;
  onSave: (values: AddressInput) => void;
  onCancel: () => void;
}) {
  return (
    <Form
      layout="vertical"
      requiredMark={false}
      disabled={saving}
      className={cx(styles.form)}
      initialValues={initial}
      onFinish={(values: RecipientFormValues) =>
        onSave({
          name: values.name.trim(),
          line1: values.line1.trim(),
          line2: values.line2?.trim() || null,
          city: values.city.trim(),
          state: values.state.trim().toUpperCase(),
          postalCode: values.postalCode.trim(),
        })
      }
    >
      {error ? <Alert className={cx(styles.alert)} type="error" showIcon title={error} /> : null}

      <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter a name." }, { max: 40, message: "40 characters at most." }]}>
        <Input autoComplete="off" />
      </Form.Item>
      <Form.Item name="line1" label="Street address" rules={[{ required: true, message: "Enter a street address." }, { max: 64, message: "64 characters at most." }]}>
        <Input autoComplete="off" />
      </Form.Item>
      <Form.Item name="line2" label="Apartment, suite, etc." rules={[{ max: 64, message: "64 characters at most." }]}>
        <Input autoComplete="off" />
      </Form.Item>
      <Form.Item name="city" label="City" rules={[{ required: true, message: "Enter a city." }]}>
        <Input autoComplete="off" />
      </Form.Item>
      <Form.Item name="state" label="State" rules={[{ required: true, pattern: /^[A-Za-z]{2}$/, message: "Use the two-letter state code." }]}>
        <Input autoComplete="off" maxLength={2} />
      </Form.Item>
      <Form.Item name="postalCode" label="ZIP" rules={[{ required: true, pattern: /^\d{5}(-\d{4})?$/, message: "Use a 5-digit ZIP code." }]}>
        <Input autoComplete="off" inputMode="numeric" />
      </Form.Item>

      <Button type="primary" htmlType="submit" loading={saving}>
        Save recipient
      </Button>{" "}
      <Button onClick={onCancel} disabled={saving}>
        Cancel
      </Button>
    </Form>
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
              initial={{ ...address, line2: address.line2 ?? "" }}
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
            initial={BLANK}
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
