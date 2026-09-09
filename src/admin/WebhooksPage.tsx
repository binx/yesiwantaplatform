import { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Input,
  Popconfirm,
  Skeleton,
  Switch,
  Table,
  Tag,
} from "antd";
import {
  WEBHOOK_EVENT_TYPES,
  type WebhookDeliverySummary,
  type WebhookEndpointSummary,
  type WebhookEventType,
} from "@shared/webhooks";
import { cx } from "@/lib/cx";
import {
  useCreateWebhookEndpoint,
  useDeleteWebhookEndpoint,
  useRedeliverWebhook,
  useRollWebhookSecret,
  useUpdateWebhookEndpoint,
  useWebhookDeliveries,
  useWebhookEndpoints,
  useStoreLocale,
} from "./queries";
import { Field } from "./Field";
import { PageHeader } from "./RequireAdmin";
import { formatOrderDate } from "./orderPresentation";
import styles from "./WebhooksPage.module.css";

/**
 * Outbound webhooks — see docs/tasks/14-outbound-webhooks.md.
 *
 * The substitute for an app ecosystem: a merchant wires their own fulfilment,
 * accounting or automation to these instead of either side shipping code into
 * the other's process.
 */

/** The recipe the README documents, shown where a merchant is actually wiring this up. */
const VERIFY_SNIPPET = `const [t, v1] = req.get("beluga-signature").split(",");
const expected = crypto
  .createHmac("sha256", process.env.BELUGA_WEBHOOK_SECRET)
  .update(\`\${t.slice(2)}.\${rawBody}\`)
  .digest("hex");

if (!crypto.timingSafeEqual(Buffer.from(v1.slice(3)), Buffer.from(expected))) {
  return res.status(400).end();
}`;

function deliveryState(delivery: WebhookDeliverySummary) {
  if (delivery.deliveredAt) return { color: "green", label: "Delivered" };
  if (delivery.failedAt) return { color: "red", label: "Gave up" };
  if (delivery.attempts > 0) return { color: "orange", label: `Retrying (${delivery.attempts})` };
  return { color: "default", label: "Queued" };
}

export function WebhooksPage() {
  const locale = useStoreLocale();
  const { message } = App.useApp();
  const endpoints = useWebhookEndpoints();
  const create = useCreateWebhookEndpoint();
  const update = useUpdateWebhookEndpoint();
  const remove = useDeleteWebhookEndpoint();
  const roll = useRollWebhookSecret();

  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [eventTypes, setEventTypes] = useState<WebhookEventType[]>(["order.paid"]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [openEndpoint, setOpenEndpoint] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Webhooks · Beluga";
  }, []);

  if (endpoints.isPending) return <Skeleton active paragraph={{ rows: 8 }} />;

  const rows = endpoints.data?.endpoints ?? [];

  const fail = (fallback: string) => (error: unknown) =>
    void message.error(error instanceof Error ? error.message : fallback);

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Tell your own systems when something happens in this store."
      />

      <div className={cx(styles.columns)}>
        <div>
          <Card title="Endpoints" className={cx(styles.card)}>
            {rows.length === 0 ? (
              <p className={cx(styles.help)}>
                Nothing is subscribed yet. Add an endpoint and Beluga will POST a signed JSON
                body to it whenever one of the events you pick happens.
              </p>
            ) : null}

            <Table<WebhookEndpointSummary>
              dataSource={rows}
              rowKey="id"
              pagination={false}
              size="middle"
              scroll={{ x: "max-content" }}
              expandable={{
                expandedRowKeys: openEndpoint ? [openEndpoint] : [],
                onExpand: (expanded, row) => setOpenEndpoint(expanded ? row.id : null),
                expandedRowRender: (row) => <DeliveryLog endpointId={row.id} />,
              }}
              columns={[
                {
                  title: "URL",
                  dataIndex: "url",
                  render: (value: string, row) => (
                    <>
                      <div className={cx(styles.url)}>{value}</div>
                      {row.description ? (
                        <div className={cx(styles.muted)}>{row.description}</div>
                      ) : null}
                    </>
                  ),
                },
                {
                  title: "Events",
                  dataIndex: "eventTypes",
                  render: (value: WebhookEventType[]) => (
                    <div className={cx(styles.events)}>
                      {value.map((type) => (
                        <Tag key={type}>{type}</Tag>
                      ))}
                    </div>
                  ),
                },
                {
                  title: "Status",
                  key: "status",
                  render: (_value, row) =>
                    row.enabled ? (
                      <Tag color="green">Enabled</Tag>
                    ) : (
                      <Tag color={row.disabledAt ? "red" : "default"}>
                        {row.disabledAt ? "Disabled after failures" : "Off"}
                      </Tag>
                    ),
                },
                {
                  title: "Last delivery",
                  key: "last",
                  render: (_value, row) =>
                    row.lastSuccessAt ? (
                      formatOrderDate(row.lastSuccessAt, true, locale)
                    ) : (
                      <span className={cx(styles.muted)}>Never</span>
                    ),
                },
                {
                  title: "",
                  key: "actions",
                  align: "right",
                  render: (_value, row) => (
                    <>
                      <Switch
                        checked={row.enabled}
                        checkedChildren="On"
                        unCheckedChildren="Off"
                        onChange={(enabled) =>
                          update.mutate(
                            {
                              id: row.id,
                              input: {
                                url: row.url,
                                description: row.description,
                                eventTypes: row.eventTypes,
                                enabled,
                              },
                            },
                            {
                              onSuccess: () =>
                                void message.success(
                                  enabled
                                    ? "Enabled. The failure count is back to zero."
                                    : "Disabled. Queued events wait until you turn it back on.",
                                ),
                              onError: fail("Could not update that endpoint."),
                            },
                          )
                        }
                      />{" "}
                      <Button
                        size="small"
                        loading={roll.isPending}
                        onClick={() =>
                          roll.mutate(row.id, {
                            onSuccess: (result) => {
                              setNewSecret(result.secret);
                              message.success("New signing secret. Copy it now.");
                            },
                            onError: fail("Could not roll that secret."),
                          })
                        }
                      >
                        Roll secret
                      </Button>{" "}
                      <Popconfirm
                        title="Delete this endpoint?"
                        description="Its delivery history goes with it. This cannot be undone."
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                        onConfirm={() =>
                          remove.mutate(row.id, {
                            onSuccess: () => void message.success("Endpoint deleted."),
                            onError: fail("Could not delete that endpoint."),
                          })
                        }
                      >
                        <Button danger size="small">
                          Delete
                        </Button>
                      </Popconfirm>
                    </>
                  ),
                },
              ]}
            />

            {rows.length > 0 ? (
              <p className={cx(styles.help)} style={{ margin: "16px 0 0" }}>
                Expand a row to see its recent deliveries.
              </p>
            ) : null}
          </Card>

          <Card title="Verifying a signature" className={cx(styles.card)}>
            <p className={cx(styles.help)}>
              Every request carries <code>beluga-signature</code>, in the same{" "}
              <code>t=…,v1=…</code> shape Stripe uses: an HMAC-SHA256 of{" "}
              <code>{"`${timestamp}.${rawBody}`"}</code> under this endpoint&rsquo;s secret. If you
              already verify Stripe&rsquo;s webhooks, this is that code with a different header
              name. Compare against the raw body, before any JSON parsing, and reject a timestamp
              older than your own tolerance — that is what makes a replay detectable.
            </p>
            <pre className={cx(styles.snippet)}>{VERIFY_SNIPPET}</pre>
          </Card>
        </div>

        <div>
          <Card title="Add an endpoint" className={cx(styles.card)}>
            <Field label="URL">
              {(control) => (
                <Input
                  {...control}
                  value={url}
                  placeholder="https://example.com/hooks/beluga"
                  onChange={(event) => setUrl(event.target.value)}
                />
              )}
            </Field>

            <Field label="Description">
              {(control) => (
                <Input
                  {...control}
                  value={description}
                  placeholder="Fulfilment provider"
                  onChange={(event) => setDescription(event.target.value)}
                />
              )}
            </Field>

            <Field label="Events">
              {() => (
                <Checkbox.Group
                  value={eventTypes}
                  onChange={(value) => setEventTypes(value)}
                  options={WEBHOOK_EVENT_TYPES.map((type) => ({ label: type, value: type }))}
                  style={{ display: "grid", gap: 6 }}
                />
              )}
            </Field>

            <p className={cx(styles.help)}>
              Must be an <code>https://</code> URL on a publicly reachable host. Addresses inside
              your own network are refused — an endpoint pointed at a metadata service would let
              anyone with admin access read this server&rsquo;s credentials.
            </p>

            <Button
              type="primary"
              block
              disabled={!url.trim() || eventTypes.length === 0}
              loading={create.isPending}
              onClick={() =>
                create.mutate(
                  {
                    url: url.trim(),
                    description: description.trim(),
                    eventTypes,
                    enabled: true,
                  },
                  {
                    onSuccess: (result) => {
                      setUrl("");
                      setDescription("");
                      setNewSecret(result.secret);
                      message.success("Endpoint added. Copy the signing secret now.");
                    },
                    onError: fail("Could not add that endpoint."),
                  },
                )
              }
            >
              Add endpoint
            </Button>

            {newSecret ? (
              <Alert
                style={{ marginTop: 16 }}
                type="info"
                showIcon
                title="Signing secret"
                description={
                  <>
                    <span>
                      Shown once. It is not stored anywhere you can read it back, so copy it into
                      your receiver now — if you lose it, roll a new one.
                    </span>
                    <code className={cx(styles.secret)}>{newSecret}</code>
                  </>
                }
              />
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * The delivery log for one endpoint.
 *
 * "Redeliver this one" is the whole of the retry UI, deliberately: anything
 * more is a queue console, and the backoff already handles the case it would
 * exist for.
 */
function DeliveryLog({ endpointId }: { endpointId: string }) {
  const { message } = App.useApp();
  const locale = useStoreLocale();
  const deliveries = useWebhookDeliveries(endpointId);
  const redeliver = useRedeliverWebhook();

  if (deliveries.isPending) return <Skeleton active paragraph={{ rows: 3 }} />;

  const rows = deliveries.data?.deliveries ?? [];

  if (rows.length === 0) {
    return <p className={cx(styles.help)}>Nothing has been sent to this endpoint yet.</p>;
  }

  return (
    <Table<WebhookDeliverySummary>
      dataSource={rows}
      rowKey="id"
      pagination={false}
      size="small"
      scroll={{ x: "max-content" }}
      columns={[
        { title: "Event", dataIndex: "eventType" },
        {
          title: "When",
          dataIndex: "createdAt",
          render: (value: number) => formatOrderDate(value, true, locale),
        },
        {
          title: "Status",
          key: "status",
          render: (_value, row) => {
            const state = deliveryState(row);
            return <Tag color={state.color}>{state.label}</Tag>;
          },
        },
        {
          title: "Response",
          dataIndex: "responseStatus",
          render: (value: number | null, row) =>
            value ?? <span className={cx(styles.muted)}>{row.error ? "no response" : "—"}</span>,
        },
        {
          title: "Detail",
          dataIndex: "error",
          render: (value: string | null) =>
            value ? <span className={cx(styles.muted)}>{value}</span> : null,
        },
        {
          title: "",
          key: "actions",
          align: "right",
          render: (_value, row) => (
            <Button
              size="small"
              loading={redeliver.isPending}
              onClick={() =>
                redeliver.mutate(
                  { endpointId, deliveryId: row.id },
                  {
                    onSuccess: () => void message.success("Queued for redelivery."),
                    onError: (error: unknown) =>
                      void message.error(
                        error instanceof Error ? error.message : "Could not redeliver that.",
                      ),
                  },
                )
              }
            >
              Redeliver
            </Button>
          ),
        },
      ]}
    />
  );
}
