import { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Form, Input, Popconfirm, Select, Skeleton } from "antd";
import { SHIPPABLE_COUNTRIES, countryName } from "@shared/shipping";
import type { AddressInput, CustomerAddress } from "@shared/account";
import {
  useAddresses,
  useCreateAddress,
  useDeleteAddress,
  useUpdateAddress,
} from "@/lib/account";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

interface AddressFormValues {
  name?: string | null;
  line1: string;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country: string;
  isDefault: boolean;
}

function blank(country?: string): AddressFormValues {
  return { line1: "", country: country ?? "US", isDefault: false };
}

function AddressForm({
  initial,
  saving,
  error,
  onSave,
  onCancel,
}: {
  initial: AddressFormValues;
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
      onFinish={(values: AddressFormValues) =>
        onSave({
          name: values.name?.trim() || null,
          line1: values.line1,
          line2: values.line2?.trim() || null,
          city: values.city?.trim() || null,
          state: values.state?.trim() || null,
          postalCode: values.postalCode?.trim() || null,
          country: values.country,
          isDefault: values.isDefault,
        })
      }
    >
      {error ? <Alert className={cx(styles.alert)} type="error" showIcon title={error} /> : null}

      <Form.Item name="name" label="Name">
        <Input autoComplete="name" />
      </Form.Item>
      <Form.Item name="line1" label="Address" rules={[{ required: true, message: "Enter an address." }]}>
        <Input autoComplete="address-line1" />
      </Form.Item>
      <Form.Item name="line2" label="Apartment, suite, etc.">
        <Input autoComplete="address-line2" />
      </Form.Item>
      <Form.Item name="city" label="City">
        <Input autoComplete="address-level2" />
      </Form.Item>
      <Form.Item name="state" label="State / province">
        <Input autoComplete="address-level1" />
      </Form.Item>
      <Form.Item name="postalCode" label="Postal code">
        <Input autoComplete="postal-code" />
      </Form.Item>
      <Form.Item name="country" label="Country" rules={[{ required: true }]}>
        <Select
          showSearch
          optionFilterProp="label"
          options={SHIPPABLE_COUNTRIES.map((code) => ({ label: countryName(code), value: code }))}
        />
      </Form.Item>
      <Form.Item name="isDefault" valuePropName="checked">
        <Checkbox>Use as my default address</Checkbox>
      </Form.Item>

      <Button type="primary" htmlType="submit" loading={saving}>
        Save address
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
  // "new" is a sentinel for the add-address form; anything else is an address id.
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Addresses · Your account";
  }, []);

  if (addresses.isPending) return <Skeleton active paragraph={{ rows: 4 }} />;

  const list = addresses.data ?? [];

  return (
    <div>
      {list.length === 0 && editing !== "new" ? (
        <p className={cx(styles.empty)}>You haven't saved an address yet.</p>
      ) : null}

      {list.map((address) =>
        editing === address.id ? (
          <div key={address.id} className={cx(styles.card)}>
            <AddressForm
              initial={address}
              saving={update.isPending}
              error={update.error instanceof Error ? update.error.message : null}
              onCancel={() => setEditing(null)}
              onSave={(input) =>
                update.mutate(
                  { id: address.id, input },
                  { onSuccess: () => setEditing(null) },
                )
              }
            />
          </div>
        ) : (
          <AddressCard
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
          <AddressForm
            initial={blank()}
            saving={create.isPending}
            error={create.error instanceof Error ? create.error.message : null}
            onCancel={() => setEditing(null)}
            onSave={(input) => create.mutate(input, { onSuccess: () => setEditing(null) })}
          />
        </div>
      ) : (
        <Button onClick={() => setEditing("new")}>Add an address</Button>
      )}
    </div>
  );
}

function AddressCard({
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
          {address.name ? (
            <>
              {address.name}
              <br />
            </>
          ) : null}
          {address.line1}
          {address.line2 ? `, ${address.line2}` : ""}
          <br />
          {[address.city, address.state, address.postalCode].filter(Boolean).join(", ")}
          <br />
          {countryName(address.country)}
          {address.isDefault ? <span className={cx(styles.default)}>Default</span> : null}
        </p>
        <div className={cx(styles.cardActions)}>
          <Button size="small" onClick={onEdit}>
            Edit
          </Button>
          <Popconfirm title="Remove this address?" onConfirm={onDelete}>
            <Button size="small" danger loading={deleting}>
              Remove
            </Button>
          </Popconfirm>
        </div>
      </div>
    </div>
  );
}
