import { z } from "zod";

/**
 * Outbound webhooks — the contract, shared by both sides of the wire.
 *
 * See docs/tasks/14-outbound-webhooks.md. Beluga is already a correct
 * at-least-once webhook *consumer* (server/routes/webhook.ts); this is the
 * producer, built to the same guarantee and signed in the same shape Stripe
 * uses, so a merchant who already verifies Stripe signatures can reuse that
 * code against us.
 */

export const webhookEventTypeSchema = z.enum([
  /** Payment confirmed by the Stripe webhook. The one every integration wants. */
  "order.paid",
  /** Fulfilment changed: status, carrier or tracking number. */
  "order.updated",
  /** A refund settled — whole or partial; compare `refundedCents` to `totalCents`. */
  "order.refunded",
  "order.cancelled",
  /** A product reached Stripe via an explicit publish. */
  "product.published",
  /** A finite variant fell to or below `LOW_INVENTORY_THRESHOLD` after a sale. */
  "inventory.low",
]);

export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;

export const WEBHOOK_EVENT_TYPES = webhookEventTypeSchema.options;

/**
 * Units below which a finite variant is worth telling a fulfilment system
 * about.
 *
 * A constant rather than a store setting on purpose: the brief scopes this
 * change to two tables, and a threshold column is a third schema decision that
 * wants its own UI and its own migration. Subscribers that want a different
 * number can filter on the `remaining` field in the payload.
 */
export const LOW_INVENTORY_THRESHOLD = 5;

/** The header carrying `t=<unix seconds>,v1=<hex hmac>`, Stripe's shape. */
export const SIGNATURE_HEADER = "beluga-signature";

/** The header carrying the delivery's event id, so a consumer can dedup on it. */
export const EVENT_ID_HEADER = "beluga-event-id";

/**
 * Endpoint input.
 *
 * The URL is only checked for *shape* here. Whether it is https, and whether
 * its hostname resolves to an address the host should be talking to, are
 * decided in `server/webhooks.ts` — both depend on DNS and on the self-hoster's
 * opt-out env var, neither of which exists on the client.
 */
export const webhookEndpointInputSchema = z.object({
  url: z.string().url("Enter a full URL, including https://").max(2000),
  description: z.string().max(200).default(""),
  eventTypes: z
    .array(webhookEventTypeSchema)
    .min(1, "Subscribe to at least one event.")
    .max(WEBHOOK_EVENT_TYPES.length),
  enabled: z.boolean().default(true),
});

export type WebhookEndpointInput = z.infer<typeof webhookEndpointInputSchema>;

/**
 * An endpoint as the client is allowed to see it.
 *
 * There is no `secret` here and there must never be one — it is returned by
 * the create and roll routes exactly once, and is unrecoverable afterwards.
 */
export interface WebhookEndpointSummary {
  id: string;
  url: string;
  description: string;
  eventTypes: WebhookEventType[];
  enabled: boolean;
  /** Reset by any success. `disabledAt` is set once this crosses the cap. */
  consecutiveFailures: number;
  disabledAt: number | null;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  createdAt: number;
}

export interface WebhookDeliverySummary {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: WebhookEventType;
  attempts: number;
  nextAttemptAt: number | null;
  responseStatus: number | null;
  error: string | null;
  deliveredAt: number | null;
  failedAt: number | null;
  createdAt: number;
}
