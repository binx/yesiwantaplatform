import { useState } from "react";
import { Alert, App, Button } from "antd";
import type { Recipient } from "@shared/postcards";
import { formatRecipient } from "@shared/postcards";
import { RecipientFields } from "@/components/postcard/RecipientFields";
import { useCustomer, useUpdateAddress } from "@/lib/account";
import { BLANK_RECIPIENT, validateRecipient, type RecipientErrors } from "@/lib/recipient-form";
import { useStore } from "@/lib/useStore";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

/**
 * Where the cards go. One address per account, copied onto every open
 * subscription when it changes, so moving house is one form.
 */
export function AccountAddressPage() {
  const store = useStore();
  const customer = useCustomer();
  const update = useUpdateAddress();
  const { message } = App.useApp();
  const [draft, setDraft] = useState<Recipient>(customer.data?.address ?? { ...BLANK_RECIPIENT, name: customer.data?.name ?? "" });
  const [errors, setErrors] = useState<RecipientErrors>({});


  const submit = () => {
    const result = validateRecipient(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    update.mutate(result.value, {
      onSuccess: ({ verification }) => {
        message.success(verification.changed && verification.suggested ? "Saved. USPS knows it slightly differently; that's fine." : "Saved.");
      },
    });
  };

  return (
    <div>
      {customer.data?.address ? (
        <p className={cx(styles.meta)}>
          Currently: <strong>{customer.data.address.name}</strong>, {formatRecipient(customer.data.address, store.locale)}
        </p>
      ) : (
        <p className={cx(styles.meta)}>No address yet. Subscribing asks for one; you can set it here first.</p>
      )}

      <div className={styles.addressForm}>
        <RecipientFields
          draft={draft}
          errors={errors}
          locale={store.locale}
          allowInternational
          onChange={(key, value) => {
            setDraft((current) => ({ ...current, [key]: value }));
            if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
          }}
        />
      </div>

      {update.isError ? <Alert className={cx(styles.alert)} type="error" showIcon title={update.error instanceof Error ? update.error.message : "Could not save."} /> : null}

      <p>
        <Button type="primary" loading={update.isPending} onClick={submit}>
          Save address
        </Button>
      </p>
      <p className={cx(styles.meta)}>Every subscription you hold is updated at once. A card already at the printer goes to the old address.</p>
    </div>
  );
}
