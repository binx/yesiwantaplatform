import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Card, Input, Select, Skeleton, Switch, Tag } from "antd";
import type { SettingsInput } from "@shared/api";
import { DEFAULT_TAX_CODE, defaultTheme, type TaxBehavior, type Theme } from "@shared/schema";
import { cx } from "@/lib/cx";
import { useEnvironment, useSettings, useUpdateSettings } from "./queries";
import { Field } from "./Field";
import { PageHeader } from "./RequireAdmin";
import { ThemeEditor } from "./ThemeEditor";
import styles from "./SettingsPage.module.css";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "SEK", "NZD", "CHF", "DKK"];

/**
 * Store settings.
 *
 * The About text is the interesting part, because v1 lost it. Its editor read
 * the saved copy with `useState(config.aboutText)` where a `useEffect` was
 * meant (finding, `config/AboutPage.js:11`): the config arrived *after* the
 * first render, so the field initialised to empty and saving wrote that empty
 * string over whatever was there.
 *
 * The fix is not "use an effect" but the rule underneath it: this form does
 * not exist until the saved values are in hand. Nothing is submitted from a
 * state that was never hydrated.
 */
export function SettingsPage() {
  const settings = useSettings();

  useEffect(() => {
    document.title = "Settings · Beluga";
  }, []);

  if (settings.isPending) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (settings.isError || !settings.data) {
    return <Alert type="error" showIcon title="Could not load your settings." />;
  }

  // Keyed on the loaded values, so the form is constructed with them rather
  // than mounted empty and patched afterwards.
  return <SettingsForm initial={settings.data} />;
}

function SettingsForm({ initial }: { initial: SettingsInput }) {
  const { message } = App.useApp();
  const update = useUpdateSettings();
  const environment = useEnvironment();

  const [name, setName] = useState(initial.name);
  const [currency, setCurrency] = useState(initial.currency);
  const [publishableKey, setPublishableKey] = useState(initial.stripePublishableKey ?? "");
  const [aboutText, setAboutText] = useState(initial.aboutText ?? "");
  const [taxEnabled, setTaxEnabled] = useState(initial.taxEnabled);
  const [taxBehavior, setTaxBehavior] = useState<TaxBehavior>(initial.taxBehavior);
  const [defaultTaxCode, setDefaultTaxCode] = useState(initial.defaultTaxCode);
  const [theme, setTheme] = useState<Theme>(initial.theme ?? defaultTheme);

  const saved = useRef(initial);

  const dirty =
    name !== saved.current.name ||
    currency !== saved.current.currency ||
    publishableKey !== (saved.current.stripePublishableKey ?? "") ||
    aboutText !== (saved.current.aboutText ?? "") ||
    taxEnabled !== saved.current.taxEnabled ||
    taxBehavior !== saved.current.taxBehavior ||
    defaultTaxCode !== saved.current.defaultTaxCode ||
    JSON.stringify(theme) !== JSON.stringify(saved.current.theme);

  const keyLooksSecret = publishableKey.trim().startsWith("sk_");
  const currencyChanged = currency !== initial.currency;
  const taxCodeLooksWrong =
    defaultTaxCode.trim() !== "" && !/^txcd_[0-9]+$/.test(defaultTaxCode.trim());
  // Immutable on a Stripe Price, so this is not a setting that quietly applies
  // to what is already published — see the warning below.
  const behaviorChanged = taxEnabled && taxBehavior !== initial.taxBehavior;

  const submit = () => {
    const input: SettingsInput = {
      name: name.trim(),
      currency,
      stripePublishableKey: publishableKey.trim() || null,
      // Empty means "no About page", which is a real choice — but it can only
      // be reached by clearing the field, never by the form never having been
      // filled in.
      aboutText: aboutText.trim() || null,
      taxEnabled,
      taxBehavior,
      defaultTaxCode: defaultTaxCode.trim() || DEFAULT_TAX_CODE,
      theme,
    };

    update.mutate(input, {
      onSuccess: () => {
        saved.current = input;
        message.success("Saved.");
      },
      onError: (error: unknown) =>
        void message.error(error instanceof Error ? error.message : "Could not save."),
    });
  };

  return (
    <>
      <PageHeader
        title="Settings"
        description="How the store presents itself, and where its public Stripe key comes from."
        actions={
          <Button
            type="primary"
            disabled={!dirty || keyLooksSecret || taxCodeLooksWrong || name.trim() === ""}
            loading={update.isPending}
            onClick={submit}
          >
            Save changes
          </Button>
        }
      />

      <Card title="Identity" className={cx(styles.card)}>
        <Field label="Store name" help="Shown in the banner, the page title, and order emails.">
          {(control) => (
            <Input {...control} value={name} onChange={(event) => setName(event.target.value)} />
          )}
        </Field>

        <Field
          label="Currency"
          help="Prices are stored as whole units of this currency's smallest denomination."
        >
          {(control) => (
            <Select
              {...control}
              className={cx(styles.currency)}
              value={currency}
              onChange={setCurrency}
              showSearch
              options={CURRENCIES.map((code) => ({ label: code, value: code }))}
            />
          )}
        </Field>

        {currencyChanged ? (
          <Alert
            type="warning"
            showIcon
            title="Changing the currency does not convert any prices"
            description={`Every price stays the number it is: 1999 was ${initial.currency} 19.99 and becomes ${currency} 19.99. Products already published to Stripe keep their existing Prices until you publish them again.`}
          />
        ) : null}
      </Card>

      <Card title="Stripe" className={cx(styles.card)}>
        {environment.data ? (
          <p className={cx(styles.wiring)}>
            {environment.data.hasStripeSecret ? (
              <>
                Secret key configured on the server{" "}
                <Tag color={environment.data.stripeMode === "live" ? "red" : "blue"}>
                  {environment.data.stripeMode} mode
                </Tag>
                {environment.data.hasWebhookSecret ? (
                  <Tag color="green">webhooks on</Tag>
                ) : (
                  <Tag color="orange">no webhook secret</Tag>
                )}
              </>
            ) : (
              <>No secret key on the server, so nothing can be sold yet.</>
            )}
          </p>
        ) : null}

        <Field
          label="Publishable key"
          {...(keyLooksSecret
            ? {
                error:
                  "That is a secret key. It must never be stored here — it would be sent to every shopper's browser.",
              }
            : {
                help: "Public by design; it is served to the storefront. The secret key lives only in the server's environment and is never editable from a browser.",
              })}
        >
          {(control) => (
            <Input
              {...control}
              value={publishableKey}
              placeholder="pk_test_…"
              status={keyLooksSecret ? "error" : ""}
              onChange={(event) => setPublishableKey(event.target.value)}
            />
          )}
        </Field>
      </Card>

      <Card title="Tax" className={cx(styles.card)}>
        <p className={cx(styles.wiring)}>
          Tax is calculated by <strong>Stripe Tax</strong>. Beluga does no tax arithmetic of
          its own and files nothing on your behalf.
        </p>

        <Alert
          className={cx(styles.notice)}
          type="info"
          showIcon
          title="Three things have to be true in Stripe before this is correct"
          description={
            <ul className={cx(styles.checklist)}>
              <li>
                Stripe Tax is activated on your account. It is a paid add-on, billed per
                transaction.
              </li>
              <li>
                Your <strong>tax registrations</strong> are recorded in the Stripe dashboard,
                one per place you are obliged to collect. Deciding where you are obliged is
                yours, not Stripe&rsquo;s and not ours — Stripe collects nothing for a
                jurisdiction you have not registered.
              </li>
              <li>
                Your products carry tax codes. Turning this on gives every product the store
                default below until you publish something more specific.
              </li>
            </ul>
          }
        />

        <div className={cx(styles.toggleRow)}>
          <Switch
            checked={taxEnabled}
            onChange={setTaxEnabled}
            aria-label="Collect tax at checkout"
          />
          <div>
            <p className={cx(styles.toggleLabel)}>
              {taxEnabled ? "Collecting tax at checkout" : "Not collecting tax"}
            </p>
            <p className={cx(styles.help)}>
              {taxEnabled
                ? "Stripe calculates tax on each order from the buyer's address."
                : "Every order is charged with no tax added. If you are obliged to collect, you owe the difference."}
            </p>
          </div>
        </div>

        {taxEnabled ? (
          <>
            <Field
              label="How prices are quoted"
              help="EU and UK stores normally quote inclusive prices; US stores quote exclusive and add tax at checkout."
            >
              {(control) => (
                <Select
                  {...control}
                  className={cx(styles.currency)}
                  value={taxBehavior}
                  onChange={(value: TaxBehavior) => setTaxBehavior(value)}
                  options={[
                    { label: "Tax added at checkout (exclusive)", value: "exclusive" },
                    { label: "Tax already in the price (inclusive)", value: "inclusive" },
                  ]}
                />
              )}
            </Field>

            {behaviorChanged ? (
              <Alert
                className={cx(styles.notice)}
                type="warning"
                showIcon
                title="Published products need publishing again"
                description="Stripe will not let a Price change its tax behaviour, so this only reaches Stripe when each product is published again — which creates new Prices and archives the old ones. Historic orders keep resolving against the archived ones. The overview lists what is out of date."
              />
            ) : null}

            <Field
              label="Default tax code"
              {...(taxCodeLooksWrong
                ? { error: "A Stripe tax code looks like txcd_99999999." }
                : {
                    help: `Used for every product that does not set its own. ${DEFAULT_TAX_CODE} is Stripe's general tangible-goods code; digital goods, books and food are taxed differently in many places.`,
                  })}
            >
              {(control) => (
                <Input
                  {...control}
                  value={defaultTaxCode}
                  placeholder={DEFAULT_TAX_CODE}
                  status={taxCodeLooksWrong ? "error" : ""}
                  onChange={(event) => setDefaultTaxCode(event.target.value.trim())}
                />
              )}
            </Field>
          </>
        ) : null}
      </Card>

      <Card title="About page" className={cx(styles.card)}>
        <p className={cx(styles.wiring)}>
          Superseded by <strong>Pages</strong>, which can hold this and everything else a
          store needs to publish. This field is kept for one release; the copy below has
          already been copied into a page.
        </p>

        <Field label="Text" help="Leave it empty to drop the About link from the banner.">
          {(control) => (
            <Input.TextArea
              {...control}
              value={aboutText}
              onChange={(event) => setAboutText(event.target.value)}
              autoSize={{ minRows: 6, maxRows: 24 }}
              placeholder="Who you are, what you make, how to reach you."
            />
          )}
        </Field>
      </Card>

      <Card title="Look" className={cx(styles.card)}>
        <ThemeEditor value={theme} onChange={setTheme} storeName={name} />
      </Card>

      <div className={cx(styles.footer)}>
        <Button
          type="primary"
          disabled={!dirty || keyLooksSecret || taxCodeLooksWrong || name.trim() === ""}
          loading={update.isPending}
          onClick={submit}
        >
          Save changes
        </Button>
        {dirty ? <span className={cx(styles.help)}>You have unsaved changes.</span> : null}
      </div>
    </>
  );
}
