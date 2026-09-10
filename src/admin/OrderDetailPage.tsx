import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, App, Button, Card, Checkbox, Descriptions, Empty, Input, Popconfirm, Select, Skeleton } from "antd";
import type { Order, RefundReason } from "@shared/orders";
import { summarisePostcards } from "@shared/orders";
import { formatMoney, parseCents } from "@shared/money";
import type { Postcard } from "@shared/postcards";
import { ApiError } from "@/lib/api";
import { cx } from "@/lib/cx";
import { PostcardSchedule, TrackingTimeline } from "@/components/postcard/PostcardSchedule";
import {
  useCancelOrder,
  useCancelPostcard,
  useEnvironment,
  useOrder,
  useRefundOrder,
  useRetryPostcard,
  useStoreLocale,
} from "./queries";
import { Field } from "./Field";
import { PageHeader } from "./RequireAdmin";
import { OrderStatusTag } from "./OrderStatusTag";
import { formatOrderDate, postcardStatusLabel } from "./orderPresentation";
import styles from "./OrderDetailPage.module.css";

/**
 * One order, card by card.
 *
 * The thing this page exists for is the failed card: Lob's refusal, in Lob's
 * own words, next to a Retry button. v1 logged the error to a console nobody
 * was watching and set the row to `error`, and that was the end of it.
 */
export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { message, modal } = App.useApp();

  const order = useOrder(id);
  const locale = useStoreLocale();
  const cancel = useCancelOrder();
  const retry = useRetryPostcard();
  const cancelCard = useCancelPostcard();

  useEffect(() => {
    document.title = order.data ? `Order ${order.data.reference} · Admin` : "Order · Admin";
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
  const counts = summarisePostcards(current);
  const price = (cents: number) => formatMoney(cents, current.currency, locale);
  const canCancel = current.status === "paid" || current.status === "pending";

  const fail = (fallback: string) => (error: unknown) =>
    void message.error(error instanceof Error ? error.message : fallback);

  const renderStatus = (postcard: Postcard) => (
    <div className={cx(styles.postcardStatus)}>
      <span>{postcardStatusLabel(postcard.status)}</span>
      {postcard.status === "sent" && postcard.lobUrl ? (
        <a href={postcard.lobUrl} target="_blank" rel="noreferrer">
          Proof
        </a>
      ) : null}
      {postcard.status === "sent" && postcard.expectedDeliveryDate ? (
        <span className={cx(styles.muted)}>expected {postcard.expectedDeliveryDate}</span>
      ) : null}
      {postcard.lastError && (postcard.status === "error" || postcard.trackingStatus === "postcard.returned_to_sender") ? (
        <span className={cx(styles.errorText)}>{postcard.lastError}</span>
      ) : null}
      <TrackingTimeline postcard={postcard} locale={locale} />
      {postcard.status === "error" || postcard.status === "cancelled" ? (
        <Button
          size="small"
          loading={retry.isPending}
          onClick={() =>
            retry.mutate(
              { orderId: current.id, postcardId: postcard.id },
              { onSuccess: () => void message.success("Back on the schedule."), onError: fail("Could not retry.") },
            )
          }
        >
          Retry
        </Button>
      ) : null}
      {postcard.status === "scheduled" || postcard.status === "error" ? (
        <Popconfirm
          title="Withdraw this postcard?"
          description="It will not be printed. The money is not refunded by this."
          onConfirm={() =>
            cancelCard.mutate(
              { orderId: current.id, postcardId: postcard.id },
              { onSuccess: () => void message.success("Withdrawn."), onError: fail("Could not withdraw it.") },
            )
          }
        >
          <Button size="small" danger loading={cancelCard.isPending}>
            Withdraw
          </Button>
        </Popconfirm>
      ) : null}
    </div>
  );

  return (
    <>
      <PageHeader
        title={`Order ${current.reference}`}
        description={
          <>
            Placed {formatOrderDate(current.createdAt, true, locale)} · <OrderStatusTag order={current} locale={locale} />
          </>
        }
        actions={
          <Link to="/admin/orders">
            <Button>All orders</Button>
          </Link>
        }
      />

      {counts.error > 0 ? (
        <Alert
          className={cx(styles.alert)}
          type="error"
          showIcon
          title={`${counts.error} postcard${counts.error === 1 ? "" : "s"} failed to send`}
          description="Lob's reason is shown on each. Fix what it names — usually the address — then Retry; the next sweep sends it. Or withdraw the card and refund the buyer for it."
        />
      ) : null}

      <div className={cx(styles.columns)}>
        <div className={cx(styles.main)}>
          <Card title="Postcards" className={cx(styles.card)}>
            <PostcardSchedule order={current} locale={locale} renderStatus={renderStatus} />
            <p className={cx(styles.snapshotNote)}>
              {counts.sent} sent · {counts.scheduled} scheduled · {counts.error} failed · {counts.cancelled} cancelled
            </p>
          </Card>

          <Card title="Customer" className={cx(styles.card)}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Email">{current.email}</Descriptions.Item>
              <Descriptions.Item label="Postcards">
                {current.postcardCount - current.internationalCount} × {price(current.unitPriceCents)}
                {current.internationalCount > 0 && current.internationalUnitPriceCents !== null
                  ? ` + ${current.internationalCount} abroad × ${price(current.internationalUnitPriceCents)}`
                  : ""}
              </Descriptions.Item>
              <Descriptions.Item label="Subtotal">{price(current.subtotalCents)}</Descriptions.Item>
              {current.discountCents > 0 ? (
                <Descriptions.Item label="Discount">−{price(current.discountCents)}</Descriptions.Item>
              ) : null}
              <Descriptions.Item label="Total">{price(current.totalCents)}</Descriptions.Item>
              {current.refundedCents > 0 ? (
                <Descriptions.Item label="Refunded">{price(current.refundedCents)}</Descriptions.Item>
              ) : null}
            </Descriptions>
          </Card>
        </div>

        <div className={cx(styles.side)}>
          <Card title="Order" className={cx(styles.card)}>
            <p className={cx(styles.help)}>
              Cancelling withdraws every postcard that has not gone to print. Cards already at Lob
              are not recalled, and no money moves — refund below if it should.
            </p>
            <Button
              danger
              block
              disabled={!canCancel}
              loading={cancel.isPending}
              onClick={() => {
                modal.confirm({
                  title: "Cancel this order?",
                  content: `${counts.scheduled + counts.error} postcard${counts.scheduled + counts.error === 1 ? "" : "s"} will be withdrawn.`,
                  okText: "Cancel the order",
                  okButtonProps: { danger: true },
                  onOk: () =>
                    cancel.mutateAsync(current.id).then(
                      (result) => void message.success(`Cancelled. ${result.order.postcardCount - counts.sent} postcards withdrawn.`),
                      (error: unknown) => {
                        fail("Could not cancel.")(error);
                        throw error;
                      },
                    ),
                });
              }}
            >
              Cancel order
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
 * writes the new figures, exactly as `checkout.session.completed` is what
 * marks an order paid. A full refund also withdraws every unsent card.
 */
function RefundCard({ order }: { order: Order }) {
  const { message } = App.useApp();
  const locale = useStoreLocale();
  const environment = useEnvironment();
  const refund = useRefundOrder();

  const remaining = order.totalCents - order.refundedCents;
  const [amount, setAmount] = useState(() => (remaining / 100).toFixed(2));
  const [reason, setReason] = useState<RefundReason>("requested_by_customer");
  const [notify, setNotify] = useState(false);

  const amountCents = parseCents(amount);
  const error =
    amountCents === null
      ? "Enter an amount like 1.40."
      : amountCents <= 0
        ? "A refund has to be for more than zero."
        : amountCents > remaining
          ? `That is more than the ${formatMoney(remaining, order.currency, locale)} still refundable.`
          : null;

  if (order.status === "pending") {
    return (
      <Card title="Refund" className={cx(styles.card)}>
        <p className={cx(styles.help)}>Nothing has been paid yet.</p>
      </Card>
    );
  }

  if (remaining <= 0) {
    return (
      <Card title="Refund" className={cx(styles.card)}>
        <p className={cx(styles.help)}>Refunded in full — {formatMoney(order.refundedCents, order.currency, locale)}.</p>
      </Card>
    );
  }

  return (
    <Card title="Refund" className={cx(styles.card)}>
      <p className={cx(styles.help)}>
        {order.refundedCents > 0
          ? `${formatMoney(order.refundedCents, order.currency, locale)} already refunded; ${formatMoney(remaining, order.currency, locale)} still refundable.`
          : `${formatMoney(remaining, order.currency, locale)} refundable. A full refund withdraws every postcard that has not gone to print.`}
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
          <Select<RefundReason> {...control} className={cx(styles.control)} value={reason} onChange={setReason} options={REFUND_REASONS} />
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
            : `${formatMoney(amountCents, order.currency, locale)} goes back to the customer. This cannot be undone.`
        }
        okText="Refund"
        okButtonProps={{ danger: true }}
        disabled={Boolean(error)}
        onConfirm={() => {
          if (amountCents === null || error) return;

          refund.mutate(
            {
              id: order.id,
              input: { amountCents: amountCents === remaining ? null : amountCents, reason, notify },
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
                void message.error(mutationError instanceof Error ? mutationError.message : "Could not refund."),
            },
          );
        }}
      >
        <Button danger block disabled={Boolean(error)} loading={refund.isPending}>
          Refund {amountCents !== null && !error ? formatMoney(amountCents, order.currency, locale) : ""}
        </Button>
      </Popconfirm>
    </Card>
  );
}
