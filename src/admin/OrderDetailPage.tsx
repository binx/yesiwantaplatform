import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Empty,
  Input,
  Popconfirm,
  Select,
  Skeleton,
  Table,
} from "antd";
import type { Order, OrderItem, OrderStatus, RefundReason } from "@shared/orders";
import { formatMoney, parseCents } from "@shared/money";
import { ApiError } from "@/lib/api";
import { cx } from "@/lib/cx";
import { useEnvironment, useOrder, useRefundOrder, useUpdateFulfilment } from "./queries";
import { Field } from "./Field";
import { PageHeader } from "./RequireAdmin";
import { OrderStatusTag } from "./OrderStatusTag";
import { ORDER_STATUSES, formatOrderDate, statusLabel } from "./orderPresentation";
import styles from "./OrderDetailPage.module.css";

/**
 * One order.
 *
 * Fulfilment lives entirely in our database. Stripe's Orders API — which v1
 * used for exactly this — no longer exists and has no server-side
 * replacement, so status, carrier and tracking are ours to store. Stripe
 * remains the authority on payment and nothing else.
 */
export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { message } = App.useApp();

  const order = useOrder(id);
  const environment = useEnvironment();
  const save = useUpdateFulfilment();

  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [notify, setNotify] = useState(false);

  // Adopt the server's values once, then leave the form alone.
  useEffect(() => {
    if (!order.data || status !== null) return;

    setStatus(order.data.status);
    setCarrier(order.data.carrier ?? "");
    setTracking(order.data.trackingNumber ?? "");
  }, [order.data, status]);

  useEffect(() => {
    document.title = order.data ? `Order ${order.data.reference} · Beluga` : "Order · Beluga";
  }, [order.data]);

  if (order.isPending) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (order.isError || !order.data) {
    const code = order.error instanceof ApiError ? order.error.status : 0;
    return (
      <Empty description={code === 404 ? "No order at this address." : "Could not load the order."}>
        <Link to="/admin/orders">
          <Button>Back to orders</Button>
        </Link>
      </Empty>
    );
  }

  const current = order.data;
  const changed =
    status !== current.status ||
    carrier !== (current.carrier ?? "") ||
    tracking !== (current.trackingNumber ?? "");

  return (
    <>
      <PageHeader
        title={`Order ${current.reference}`}
        description={
          <>
            Placed {formatOrderDate(current.createdAt, true)} · <OrderStatusTag order={current} />
          </>
        }
        actions={
          <Link to="/admin/orders">
            <Button>All orders</Button>
          </Link>
        }
      />

      {current.oversold ? (
        <Alert
          className={cx(styles.alert)}
          type="error"
          showIcon
          title="Paid, but stock had run out"
          description="Payment succeeded after the last unit was sold. The money has been taken, so this needs a refund or a restock before it can be fulfilled — it was recorded rather than dropped so it could not be missed."
        />
      ) : null}

      <div className={cx(styles.columns)}>
        <div className={cx(styles.main)}>
          <Card title="Items" className={cx(styles.card)}>
            <Table<OrderItem>
              dataSource={current.items}
              rowKey="id"
              pagination={false}
              size="middle"
              scroll={{ x: "max-content" }}
              columns={[
                {
                  title: "Product",
                  dataIndex: "productName",
                  render: (name: string, item) => (
                    <>
                      <div>{name}</div>
                      {item.variantLabel ? (
                        <div className={cx(styles.variant)}>{item.variantLabel}</div>
                      ) : null}
                      {Object.entries(item.options).map(([key, value]) => (
                        <div key={key} className={cx(styles.variant)}>
                          {key}: {value}
                        </div>
                      ))}
                    </>
                  ),
                },
                { title: "Qty", dataIndex: "quantity", align: "right" },
                {
                  title: "Unit",
                  dataIndex: "unitPriceCents",
                  align: "right",
                  render: (cents: number) => formatMoney(cents, current.currency),
                },
                {
                  title: "Line",
                  key: "line",
                  align: "right",
                  render: (_value, item) =>
                    formatMoney(item.unitPriceCents * item.quantity, current.currency),
                },
              ]}
              summary={() => (
                <Table.Summary>
                  <Total label="Subtotal" cents={current.subtotalCents} order={current} />
                  <Total label="Shipping" cents={current.shippingCents} order={current} />
                  <Total label="Tax" cents={current.taxCents} order={current} />
                  <Total label="Total" cents={current.totalCents} order={current} strong />
                </Table.Summary>
              )}
            />
            <p className={cx(styles.snapshotNote)}>
              Names and prices are a snapshot taken at purchase, so an order still renders as it was
              bought even after the product is renamed, repriced, or deleted.
            </p>
          </Card>

          <Card title="Customer" className={cx(styles.card)}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Email">{current.email}</Descriptions.Item>
              <Descriptions.Item label="Ship to">
                <Address order={current} />
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </div>

        <div className={cx(styles.side)}>
          <Card title="Fulfilment" className={cx(styles.card)}>
            <Field label="Status">
              {(control) => (
                <Select<OrderStatus>
                  {...control}
                  className={cx(styles.control)}
                  value={status ?? current.status}
                  onChange={setStatus}
                  options={ORDER_STATUSES.map((value) => ({ label: statusLabel(value), value }))}
                />
              )}
            </Field>

            <Field label="Carrier">
              {(control) => (
                <Input
                  {...control}
                  value={carrier}
                  placeholder="Royal Mail"
                  onChange={(event) => setCarrier(event.target.value)}
                />
              )}
            </Field>

            <Field label="Tracking number">
              {(control) => (
                <Input
                  {...control}
                  value={tracking}
                  onChange={(event) => setTracking(event.target.value)}
                />
              )}
            </Field>

            <Checkbox
              className={cx(styles.notify)}
              checked={notify}
              disabled={!environment.data?.hasEmail}
              onChange={(event) => setNotify(event.target.checked)}
            >
              Email the customer about this change
            </Checkbox>
            <p className={cx(styles.help)}>
              {environment.data?.hasEmail
                ? "Off by default, so correcting a typo does not send another email."
                : "No email provider configured — set SMTP_URL to enable this."}
            </p>

            <Button
              type="primary"
              block
              disabled={!changed}
              loading={save.isPending}
              onClick={() =>
                save.mutate(
                  {
                    id: current.id,
                    input: {
                      status: status ?? current.status,
                      carrier: carrier.trim() || null,
                      trackingNumber: tracking.trim() || null,
                      notify,
                    },
                  },
                  {
                    onSuccess: (result) => {
                      setNotify(false);
                      message.success(
                        result.emailed ? "Saved, and the customer was emailed." : "Saved.",
                      );
                    },
                    onError: (error: unknown) =>
                      void message.error(error instanceof Error ? error.message : "Could not save."),
                  },
                )
              }
            >
              Save
            </Button>
          </Card>

          <RefundCard order={current} />
        </div>
      </div>
    </>
  );
}

const REFUND_REASONS: { label: string; value: RefundReason }[] = [
  { label: "Requested by the customer", value: "requested_by_customer" },
  { label: "Duplicate charge", value: "duplicate" },
  { label: "Fraudulent", value: "fraudulent" },
];

/**
 * Refunding, in whole or in part.
 *
 * The order does not change when this succeeds: `charge.refunded` is what
 * writes the new figures, exactly as `checkout.session.completed` is what marks
 * an order paid. So the message says the refund is on its way rather than
 * claiming it has landed, and the page picks up the real total on the refetch.
 */
function RefundCard({ order }: { order: Order }) {
  const { message } = App.useApp();
  const environment = useEnvironment();
  const refund = useRefundOrder();

  const remaining = order.totalCents - order.refundedCents;
  const [amount, setAmount] = useState(() => (remaining / 100).toFixed(2));
  const [reason, setReason] = useState<RefundReason>("requested_by_customer");
  const [notify, setNotify] = useState(false);

  const amountCents = parseCents(amount);
  const error =
    amountCents === null
      ? "Enter an amount like 12.50."
      : amountCents <= 0
        ? "A refund has to be for more than zero."
        : amountCents > remaining
          ? `That is more than the ${formatMoney(remaining, order.currency)} still refundable.`
          : null;

  if (remaining <= 0) {
    return (
      <Card title="Refund" className={cx(styles.card)}>
        <p className={cx(styles.help)}>
          Refunded in full — {formatMoney(order.refundedCents, order.currency)}.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Refund" className={cx(styles.card)}>
      <p className={cx(styles.help)}>
        {order.refundedCents > 0
          ? `${formatMoney(order.refundedCents, order.currency)} already refunded; ${formatMoney(remaining, order.currency)} still refundable.`
          : `${formatMoney(remaining, order.currency)} refundable.`}
      </p>

      <Field label="Amount" error={error}>
        {(control) => (
          <Input
            {...control}
            value={amount}
            prefix={order.currency === "USD" ? "$" : order.currency}
            onChange={(event) => setAmount(event.target.value)}
          />
        )}
      </Field>

      <Field label="Reason">
        {(control) => (
          <Select<RefundReason>
            {...control}
            className={cx(styles.control)}
            value={reason}
            onChange={setReason}
            options={REFUND_REASONS}
          />
        )}
      </Field>

      <Checkbox
        className={cx(styles.notify)}
        checked={notify}
        disabled={!environment.data?.hasEmail}
        onChange={(event) => setNotify(event.target.checked)}
      >
        Email the customer about the refund
      </Checkbox>

      <Popconfirm
        title="Refund this payment?"
        description={
          amountCents === null || error
            ? "Fix the amount first."
            : `${formatMoney(amountCents, order.currency)} goes back to the customer. This cannot be undone.`
        }
        okText="Refund"
        okButtonProps={{ danger: true }}
        disabled={Boolean(error)}
        onConfirm={() => {
          if (amountCents === null || error) return;

          refund.mutate(
            {
              id: order.id,
              // A full refund is sent as null so Stripe refunds the remainder
              // itself, rather than us racing a concurrent partial.
              input: {
                amountCents: amountCents === remaining ? null : amountCents,
                reason,
                notify,
              },
            },
            {
              onSuccess: (result) => {
                setNotify(false);
                message.success(
                  result.emailed
                    ? "Refund sent to Stripe, and the customer was emailed. The order updates when Stripe confirms it."
                    : "Refund sent to Stripe. The order updates when Stripe confirms it.",
                );
              },
              onError: (mutationError: unknown) =>
                void message.error(
                  mutationError instanceof Error ? mutationError.message : "Could not refund.",
                ),
            },
          );
        }}
      >
        <Button danger block disabled={Boolean(error)} loading={refund.isPending}>
          Refund {amountCents !== null && !error ? formatMoney(amountCents, order.currency) : ""}
        </Button>
      </Popconfirm>
    </Card>
  );
}

function Total({
  label,
  cents,
  order,
  strong,
}: {
  label: string;
  cents: number;
  order: Order;
  strong?: boolean;
}) {
  return (
    <Table.Summary.Row>
      <Table.Summary.Cell index={0} colSpan={3} align="right">
        {strong ? <strong>{label}</strong> : label}
      </Table.Summary.Cell>
      <Table.Summary.Cell index={1} align="right">
        {strong ? (
          <strong>{formatMoney(cents, order.currency)}</strong>
        ) : (
          formatMoney(cents, order.currency)
        )}
      </Table.Summary.Cell>
    </Table.Summary.Row>
  );
}

/**
 * A shipping address, tolerating missing lines.
 *
 * Every field is nullable — Stripe does not always collect one, and a digital
 * order has none at all — so each is checked rather than concatenated blindly.
 */
function Address({ order }: { order: Order }) {
  const lines = [
    order.shipping.name,
    order.shipping.line1,
    order.shipping.line2,
    [order.shipping.city, order.shipping.state].filter(Boolean).join(", ") || null,
    order.shipping.postalCode,
    order.shipping.country,
  ].filter((line): line is string => Boolean(line && line.trim()));

  if (lines.length === 0) return <span className={cx(styles.muted)}>No address collected</span>;

  return (
    <address className={cx(styles.address)}>
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </address>
  );
}
