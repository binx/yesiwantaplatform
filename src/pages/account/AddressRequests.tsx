import { useState } from "react";
import { App, Button, Checkbox, Input, Modal, Popconfirm, Segmented, Tag } from "antd";
import type { AddressRequest } from "@shared/account";
import { useAddressRequests, useCreateAddressRequest, useCustomer, useRenewAddressRequest, useRevokeAddressRequest } from "@/lib/account";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

/**
 * Ask a friend for their address.
 *
 * The one thing every other way into the recipient list assumes is that
 * the customer *has* the address. Most of the time the reason a postcard
 * does not get sent is that they do not. A link fixes that: the friend
 * types it once, it lands in the book, and nobody has to text a street
 * name back and forth.
 */
export function AddressRequests({ locale }: { locale: string }) {
  const { message } = App.useApp();
  const customer = useCustomer();
  const requests = useAddressRequests();
  const create = useCreateAddressRequest();
  const renew = useRenewAddressRequest();
  const revoke = useRevokeAddressRequest();

  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [multi, setMulti] = useState(false);
  const [notify, setNotify] = useState(true);
  const [made, setMade] = useState<AddressRequest | null>(null);

  const list = requests.data ?? [];
  const hasName = Boolean(customer.data?.name?.trim());

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      void message.success("Copied.");
    } catch {
      void message.info("Select the link and copy it.");
    }
  };

  const share = async (request: AddressRequest) => {
    const text = `Could you send me your mailing address? ${request.url}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // Cancelled, or not allowed: fall through to the clipboard.
      }
    }
    await copy(request.url);
  };

  const close = () => {
    setOpen(false);
    setMade(null);
    setLabel("");
    setMulti(false);
    setNotify(true);
  };

  return (
    <section className={cx(styles.requests)} aria-labelledby="requests-heading">
      <div className={cx(styles.cardHeader)}>
        <div>
          <h2 id="requests-heading" className={cx(styles.requestsHeading)}>
            Don't have someone's address?
          </h2>
          <p className={cx(styles.meta)}>Send them a link. They type it once and it lands here.</p>
        </div>
        <Button type="primary" onClick={() => setOpen(true)}>
          Ask someone for their address
        </Button>
      </div>

      {list.length > 0 ? (
        <ul className={cx(styles.requestList)} aria-label="Your address links">
          {list.map((request) => (
            <li key={request.id} className={cx(styles.requestItem)}>
              <div className={cx(styles.requestText)}>
                <strong>{request.label}</strong>{" "}
                <Tag>{request.multi ? "many people" : "one person"}</Tag>
                <StatusTag request={request} />
                <div className={cx(styles.meta)}>
                  {request.responses} response{request.responses === 1 ? "" : "s"}
                  {request.status === "open" ? ` · expires ${new Date(request.expiresAt).toLocaleDateString(locale, { month: "short", day: "numeric" })}` : ""}
                </div>
              </div>
              <div className={cx(styles.cardActions)}>
                {request.status === "open" ? (
                  <Button size="small" onClick={() => void copy(request.url)}>
                    Copy link
                  </Button>
                ) : null}
                {request.status === "open" || request.status === "expired" ? (
                  <Button size="small" loading={renew.isPending} onClick={() => renew.mutate(request.id)}>
                    Renew
                  </Button>
                ) : null}
                {request.status !== "revoked" ? (
                  <Popconfirm title="Turn this link off?" description="Anyone opening it will be told it's no longer active." onConfirm={() => revoke.mutate(request.id)}>
                    <Button size="small" danger loading={revoke.isPending}>
                      Revoke
                    </Button>
                  </Popconfirm>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <Modal title={made ? "Your link is ready" : "Ask someone for their address"} open={open} onCancel={close} footer={null} destroyOnHidden>
        {made ? (
          <div className={cx(styles.form)}>
            <p className={cx(styles.meta)}>
              Send this to {made.multi ? "everyone you want an address from" : made.label}. It works
              {made.multi ? " for as many people as you like" : " once"} and expires in 90 days.
            </p>
            <Input readOnly value={made.url} aria-label="Your address link" onFocus={(e) => e.target.select()} />
            <div className={cx(styles.cardActions, styles.linkActions)}>
              <Button type="primary" onClick={() => void copy(made.url)}>
                Copy link
              </Button>
              <Button onClick={() => void share(made)}>Share…</Button>
              <Button type="text" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form
            className={cx(styles.form)}
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate(
                { label: label.trim(), multi, notifyByEmail: notify, expiresInDays: 90 },
                { onSuccess: (request) => setMade(request), onError: (error: unknown) => void message.error(error instanceof Error ? error.message : "Could not make the link.") },
              );
            }}
          >
            {!hasName ? (
              <p className={cx(styles.meta)}>
                Add your name on the account overview first: the page your friend opens says who is asking.
              </p>
            ) : null}
            <Segmented
              aria-label="Who the link is for"
              value={multi ? "many" : "one"}
              onChange={(value) => setMulti(value === "many")}
              options={[
                { label: "One person", value: "one" },
                { label: "Many people, one link", value: "many" },
              ]}
              block
            />
            <label className={cx(styles.fieldLabel)} htmlFor="request-label">
              {multi ? "What is it for?" : "Who is it for?"}
            </label>
            <Input id="request-label" value={label} maxLength={80} placeholder={multi ? "Holiday card 2026" : "Maya"} onChange={(e) => setLabel(e.target.value)} />
            <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)}>
              Email me when someone answers
            </Checkbox>
            <div className={cx(styles.cardActions)}>
              <Button type="primary" htmlType="submit" disabled={!hasName || label.trim() === ""} loading={create.isPending}>
                Make the link
              </Button>
              <Button onClick={close}>Cancel</Button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}

function StatusTag({ request }: { request: AddressRequest }) {
  switch (request.status) {
    case "open":
      return <Tag color="green">open</Tag>;
    case "fulfilled":
      return <Tag color="blue">answered</Tag>;
    case "expired":
      return <Tag color="gold">expired</Tag>;
    case "revoked":
      return <Tag>revoked</Tag>;
  }
}
