import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Card, Input, InputNumber, Select, Skeleton, Switch, Tooltip } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { ShippingRate, ShippingZone } from "@shared/shipping";
import { countryName, findCoverageGaps, hasCatchAllZone } from "@shared/shipping";
import { formatMoney, parseCents } from "@shared/money";
import { cx } from "@/lib/cx";
import { Field } from "./Field";
import { PageHeader } from "./RequireAdmin";
import { useSettings, useShipping, useUpdateShipping } from "./queries";
import styles from "./ShippingPage.module.css";

/**
 * Shipping rates.
 *
 * Tiers 1 and 2 from docs/shipping.md: flat rates, zones, weight bands and
 * subtotal bands. No carrier account, and the hosted Stripe checkout is
 * untouched — live carrier rates would require owning the checkout page.
 *
 * v1 had none of this: shipping was a magic Stripe SKU the browser chose, so
 * one price for the world and no address awareness at all.
 */

/** Local drafts carry a stable key so a row survives being reordered. */
interface ZoneDraft extends ShippingZone {
  key: string;
}
interface RateDraft extends Omit<ShippingRate, "priceCents"> {
  key: string;
  priceText: string;
}

let counter = 0;
const nextKey = () => `k${++counter}`;

export function ShippingPage() {
  const { message } = App.useApp();
  const shipping = useShipping();
  const settings = useSettings();
  const save = useUpdateShipping();

  const [zones, setZones] = useState<ZoneDraft[] | null>(null);
  const [rates, setRates] = useState<RateDraft[] | null>(null);

  useEffect(() => {
    document.title = "Shipping · Beluga";
  }, []);

  // Hydrated once, like every other form here: the saved values are the
  // starting point, never patched in after an empty first render.
  useEffect(() => {
    if (!shipping.data || zones !== null) return;

    setZones(shipping.data.zones.map((zone) => ({ ...zone, key: nextKey() })));
    setRates(
      shipping.data.rates.map((rate) => ({
        ...rate,
        key: nextKey(),
        priceText: (rate.priceCents / 100).toFixed(2),
      })),
    );
  }, [shipping.data, zones]);

  const currency = settings.data?.currency ?? "USD";

  const parsedRates = useMemo(
    () =>
      (rates ?? []).map((rate) => ({
        ...rate,
        priceCents: parseCents(rate.priceText) ?? 0,
      })),
    [rates],
  );

  /*
   * A gap ships free and says nothing, so it is worth surfacing before an
   * order arrives with no postage on it. Probed with a small, light cart —
   * the case most likely to fall outside a weight band's lower bound.
   */
  const gaps = useMemo(
    () =>
      zones && rates
        ? findCoverageGaps(parsedRates, zones, { weightGrams: 100, subtotalCents: 1000 })
        : [],
    [parsedRates, zones, rates],
  );

  if (shipping.isPending || zones === null || rates === null) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }

  const setZone = (key: string, patch: Partial<ZoneDraft>) =>
    setZones(zones.map((zone) => (zone.key === key ? { ...zone, ...patch } : zone)));

  const setRate = (key: string, patch: Partial<RateDraft>) =>
    setRates(rates.map((rate) => (rate.key === key ? { ...rate, ...patch } : rate)));

  const invalid =
    zones.some((zone) => zone.name.trim() === "") ||
    rates.some((rate) => rate.name.trim() === "" || parseCents(rate.priceText) === null);

  const submit = () => {
    save.mutate(
      {
        zones: zones.map((zone) => ({
          id: zone.id,
          name: zone.name.trim(),
          countryCodes: zone.countryCodes,
        })),
        rates: rates.map((rate) => ({
          id: rate.id,
          name: rate.name.trim(),
          priceCents: parseCents(rate.priceText) ?? 0,
          zoneId: rate.zoneId,
          minWeightGrams: rate.minWeightGrams,
          maxWeightGrams: rate.maxWeightGrams,
          minSubtotalCents: rate.minSubtotalCents,
          maxSubtotalCents: rate.maxSubtotalCents,
          taxBehavior: rate.taxBehavior,
          isActive: rate.isActive,
        })),
      },
      {
        onSuccess: () => {
          // Ids are reissued server-side, so adopt whatever came back.
          setZones(null);
          void shipping.refetch();
          void message.success("Shipping saved.");
        },
        onError: (error: unknown) =>
          void message.error(error instanceof Error ? error.message : "Could not save."),
      },
    );
  };

  return (
    <>
      <PageHeader
        title="Shipping"
        description="Rates a buyer picks at checkout. No carrier account needed."
        actions={
          <Button type="primary" disabled={invalid} loading={save.isPending} onClick={submit}>
            Save shipping
          </Button>
        }
      />

      {gaps.length > 0 ? (
        <Alert
          className={cx(styles.alert)}
          type="warning"
          showIcon
          title="Some destinations have no rate"
          description={
            <>
              A cart going to{" "}
              {gaps
                .slice(0, 6)
                .map((gap) => countryName(gap.countryCode))
                .join(", ")}
              {gaps.length > 6 ? ` and ${gaps.length - 6} more` : ""} matches no rate, so the buyer
              is offered no shipping option and pays nothing for postage.
            </>
          }
        />
      ) : null}

      {zones.length > 0 && !hasCatchAllZone(zones) ? (
        <Alert
          className={cx(styles.alert)}
          type="info"
          showIcon
          title="Only the countries you list can order"
          description="Checkout offers exactly the countries named below. Add a zone with no countries to price everywhere else."
        />
      ) : null}

      <Card
        className={cx(styles.card)}
        title="Zones"
        extra={
          <Button
            icon={<PlusOutlined />}
            onClick={() =>
              setZones([
                ...zones,
                {
                  key: nextKey(),
                  id: `new-${nextKey()}`,
                  name: "",
                  countryCodes: [],
                  position: zones.length,
                },
              ])
            }
          >
            Add zone
          </Button>
        }
      >
        <p className={cx(styles.intro)}>
          Groups of countries priced together. A zone with no countries is the catch-all for
          everywhere else.
        </p>

        {zones.length === 0 ? (
          <p className={cx(styles.empty)}>
            No zones. Rates below apply everywhere, which is all a single-country shop needs.
          </p>
        ) : (
          <ul className={cx(styles.rows)}>
            {zones.map((zone) => (
              <li key={zone.key} className={cx(styles.row)}>
                <Field label="Name">
                  {(control) => (
                    <Input
                      {...control}
                      value={zone.name}
                      placeholder="Domestic"
                      onChange={(event) => setZone(zone.key, { name: event.target.value })}
                    />
                  )}
                </Field>

                <Field
                  label="Countries"
                  help={
                    zone.countryCodes.length === 0
                      ? "Empty — this is the catch-all for everywhere else."
                      : `${zone.countryCodes.length} listed`
                  }
                >
                  {(control) => (
                    <Select
                      {...control}
                      mode="tags"
                      className={cx(styles.grow)}
                      value={zone.countryCodes}
                      placeholder="US, GB, DE…"
                      tokenSeparators={[",", " "]}
                      onChange={(codes: string[]) =>
                        setZone(zone.key, {
                          // Typed freely, so normalise and drop anything that
                          // is not a plausible ISO code rather than storing it.
                          countryCodes: [
                            ...new Set(
                              codes
                                .map((code) => code.trim().toUpperCase())
                                .filter((code) => /^[A-Z]{2}$/.test(code)),
                            ),
                          ],
                        })
                      }
                      options={zone.countryCodes.map((code) => ({
                        label: `${code} — ${countryName(code)}`,
                        value: code,
                      }))}
                    />
                  )}
                </Field>

                <Tooltip title="Remove zone">
                  <Button
                    className={cx(styles.rowRemove)}
                    icon={<DeleteOutlined />}
                    aria-label={`Remove zone ${zone.name || "(unnamed)"}`}
                    danger
                    onClick={() => {
                      setZones(zones.filter((z) => z.key !== zone.key));
                      // Rates pointing here become global rather than vanishing.
                      setRates(
                        rates.map((r) => (r.zoneId === zone.id ? { ...r, zoneId: null } : r)),
                      );
                    }}
                  />
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        className={cx(styles.card)}
        title="Rates"
        extra={
          <Button
            icon={<PlusOutlined />}
            onClick={() =>
              setRates([
                ...rates,
                {
                  key: nextKey(),
                  id: `new-${nextKey()}`,
                  name: "",
                  priceText: "0.00",
                  zoneId: null,
                  minWeightGrams: null,
                  maxWeightGrams: null,
                  minSubtotalCents: null,
                  maxSubtotalCents: null,
                  taxBehavior: "exclusive" as const,
                  isActive: true,
                  position: rates.length,
                },
              ])
            }
          >
            Add rate
          </Button>
        }
      >
        <p className={cx(styles.intro)}>
          A buyer sees every rate their cart qualifies for, cheapest first. Leave a limit empty for
          no limit; limits include their own value.
        </p>

        {rates.length === 0 ? (
          <p className={cx(styles.empty)}>
            No rates, so checkout offers no shipping and charges nothing for postage.
          </p>
        ) : null}

        <ul className={cx(styles.rows)}>
          {rates.map((rate) => {
            const cents = parseCents(rate.priceText);

            return (
              <li key={rate.key} className={cx(styles.rateRow)}>
                <Field label="Name">
                  {(control) => (
                    <Input
                      {...control}
                      value={rate.name}
                      placeholder="Standard"
                      onChange={(event) => setRate(rate.key, { name: event.target.value })}
                    />
                  )}
                </Field>

                <Field
                  label="Price"
                  {...(rate.priceText !== "" && cents === null
                    ? { error: "Not an amount." }
                    : { help: cents === 0 ? "Free shipping." : formatMoney(cents ?? 0, currency) })}
                >
                  {(control) => (
                    <Input
                      {...control}
                      value={rate.priceText}
                      inputMode="decimal"
                      prefix={currency}
                      onChange={(event) => setRate(rate.key, { priceText: event.target.value })}
                    />
                  )}
                </Field>

                <Field label="Zone">
                  {(control) => (
                    <Select
                      {...control}
                      className={cx(styles.grow)}
                      value={rate.zoneId}
                      onChange={(zoneId: string | null) => setRate(rate.key, { zoneId })}
                      options={[
                        { label: "Everywhere", value: null },
                        ...zones.map((zone) => ({
                          label: zone.name || "(unnamed)",
                          value: zone.id,
                        })),
                      ]}
                    />
                  )}
                </Field>

                <Field label="Weight (g)" help="Parcel weight, from variant weights.">
                  {(control) => (
                    <span className={cx(styles.range)}>
                      <InputNumber
                        {...control}
                        min={0}
                        placeholder="min"
                        value={rate.minWeightGrams}
                        onChange={(value) => setRate(rate.key, { minWeightGrams: value })}
                      />
                      <span aria-hidden="true">–</span>
                      <InputNumber
                        min={0}
                        placeholder="max"
                        aria-label={`Maximum weight for ${rate.name || "this rate"}`}
                        value={rate.maxWeightGrams}
                        onChange={(value) => setRate(rate.key, { maxWeightGrams: value })}
                      />
                    </span>
                  )}
                </Field>

                <Field label={`Order total (${currency})`} help="A minimum gives free shipping over it.">
                  {(control) => (
                    <span className={cx(styles.range)}>
                      <InputNumber
                        {...control}
                        min={0}
                        placeholder="min"
                        value={rate.minSubtotalCents === null ? null : rate.minSubtotalCents / 100}
                        onChange={(value) =>
                          setRate(rate.key, {
                            minSubtotalCents: value === null ? null : Math.round(value * 100),
                          })
                        }
                      />
                      <span aria-hidden="true">–</span>
                      <InputNumber
                        min={0}
                        placeholder="max"
                        aria-label={`Maximum order total for ${rate.name || "this rate"}`}
                        value={rate.maxSubtotalCents === null ? null : rate.maxSubtotalCents / 100}
                        onChange={(value) =>
                          setRate(rate.key, {
                            maxSubtotalCents: value === null ? null : Math.round(value * 100),
                          })
                        }
                      />
                    </span>
                  )}
                </Field>

                {settings.data?.taxEnabled ? (
                  <Field
                    label="Tax on postage"
                    help="Shipping is taxable in some places and not others; Stripe decides which, from the destination."
                  >
                    {(control) => (
                      <Select
                        {...control}
                        className={cx(styles.grow)}
                        value={rate.taxBehavior}
                        onChange={(taxBehavior: "exclusive" | "inclusive") =>
                          setRate(rate.key, { taxBehavior })
                        }
                        options={[
                          { label: "Added to the price", value: "exclusive" },
                          { label: "Already in the price", value: "inclusive" },
                        ]}
                      />
                    )}
                  </Field>
                ) : null}

                <div className={cx(styles.rateActions)}>
                  <Tooltip title={rate.isActive ? "Offered at checkout" : "Hidden from checkout"}>
                    <Switch
                      checked={rate.isActive}
                      aria-label={`${rate.name || "This rate"} is offered at checkout`}
                      onChange={(isActive) => setRate(rate.key, { isActive })}
                    />
                  </Tooltip>
                  <Tooltip title="Remove rate">
                    <Button
                      icon={<DeleteOutlined />}
                      aria-label={`Remove rate ${rate.name || "(unnamed)"}`}
                      danger
                      type="text"
                      onClick={() => setRates(rates.filter((r) => r.key !== rate.key))}
                    />
                  </Tooltip>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
