import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Card, Input, InputNumber, Select, Skeleton, Space, Switch, Tag, Upload } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { SettingsInput } from "@shared/api";
import { formatMoney, parseCents } from "@shared/money";
import type { Recipient } from "@shared/postcards";
import { BLANK_RECIPIENT, validateRecipient, type RecipientErrors } from "@/lib/recipient-form";
import { RecipientFields } from "@/components/postcard/RecipientFields";
import { defaultHero, defaultTheme, heroHrefSchema, localeSchema, type Hero, type Theme } from "@shared/schema";
import { cx } from "@/lib/cx";
import {
  useEnvironment,
  useSendTestEmail,
  useSendTestPostcard,
  useSettings,
  useUpdateSettings,
  useUploadHeroImage,
} from "./queries";
import { Field } from "./Field";
import { PageHeader } from "./RequireAdmin";
import { ThemeEditor } from "./ThemeEditor";
import styles from "./SettingsPage.module.css";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "SEK", "NZD", "CHF", "DKK"];

const LOCALES = [
  { value: "en-US", label: "English (United States) — en-US" },
  { value: "en-GB", label: "English (United Kingdom) — en-GB" },
  { value: "en-CA", label: "English (Canada) — en-CA" },
  { value: "en-AU", label: "English (Australia) — en-AU" },
  { value: "de-DE", label: "German (Germany) — de-DE" },
  { value: "fr-FR", label: "French (France) — fr-FR" },
  { value: "es-ES", label: "Spanish (Spain) — es-ES" },
];

function localeExample(locale: string, currency: string): string {
  try {
    return `Prices read ${formatMoney(140, currency, locale)}.`;
  } catch {
    return "";
  }
}

/**
 * Store settings. The form does not exist until the saved values are in
 * hand, so nothing is ever submitted from a state that was never hydrated.
 */
export function SettingsPage() {
  const settings = useSettings();

  useEffect(() => {
    document.title = "Settings · Admin";
  }, []);

  if (settings.isPending) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (settings.isError || !settings.data) {
    return <Alert type="error" showIcon title="Could not load your settings." />;
  }

  return <SettingsForm initial={settings.data} />;
}

function SettingsForm({ initial }: { initial: SettingsInput }) {
  const { message } = App.useApp();
  const update = useUpdateSettings();
  const environment = useEnvironment();

  const [name, setName] = useState(initial.name);
  const [currency, setCurrency] = useState(initial.currency);
  const [locale, setLocale] = useState(initial.locale);
  const [publishableKey, setPublishableKey] = useState(initial.stripePublishableKey ?? "");
  const [price, setPrice] = useState((initial.postcardPriceCents / 100).toFixed(2));
  const [internationalPrice, setInternationalPrice] = useState(
    initial.internationalPostcardPriceCents === null ? "" : (initial.internationalPostcardPriceCents / 100).toFixed(2),
  );
  const [returnAddress, setReturnAddress] = useState<Recipient>(initial.returnAddress ?? BLANK_RECIPIENT);
  const [returnAddressErrors, setReturnAddressErrors] = useState<RecipientErrors>({});
  const [cartRecoveryEnabled, setCartRecoveryEnabled] = useState(initial.cartRecoveryEnabled);
  const [cartRecoveryDelayHours, setCartRecoveryDelayHours] = useState(initial.cartRecoveryDelayHours);
  const [theme, setTheme] = useState<Theme>(initial.theme ?? defaultTheme);
  const [hero, setHero] = useState<Hero>(initial.hero ?? defaultHero);

  const saved = useRef(initial);
  const priceCents = parseCents(price);
  const priceWrong = priceCents === null || priceCents < 50;

  // International is on when there is a price. Empty means "US only", and
  // then the return address is optional — Lob only needs it to mail abroad.
  const internationalCents = internationalPrice.trim() === "" ? null : parseCents(internationalPrice);
  const internationalWrong = internationalPrice.trim() !== "" && (internationalCents === null || internationalCents < 50);
  const returnAddressTyped = [returnAddress.name, returnAddress.line1, returnAddress.city, returnAddress.state, returnAddress.postalCode].some((v) => v.trim() !== "");
  const returnAddressResult = returnAddressTyped ? validateRecipient({ ...returnAddress, country: "US" }) : null;
  const returnAddressWrong = returnAddressResult !== null && !returnAddressResult.ok;
  const returnAddressMissing = internationalCents !== null && !returnAddressTyped;
  const returnAddressValue = returnAddressResult?.ok ? returnAddressResult.value : null;

  const dirty =
    name !== saved.current.name ||
    currency !== saved.current.currency ||
    locale !== saved.current.locale ||
    publishableKey !== (saved.current.stripePublishableKey ?? "") ||
    priceCents !== saved.current.postcardPriceCents ||
    internationalCents !== saved.current.internationalPostcardPriceCents ||
    JSON.stringify(returnAddressValue) !== JSON.stringify(saved.current.returnAddress) ||
    cartRecoveryEnabled !== saved.current.cartRecoveryEnabled ||
    cartRecoveryDelayHours !== saved.current.cartRecoveryDelayHours ||
    JSON.stringify(theme) !== JSON.stringify(saved.current.theme) ||
    JSON.stringify(hero) !== JSON.stringify(saved.current.hero);

  const keyLooksSecret = publishableKey.trim().startsWith("sk_");
  const heroHrefWrong =
    (hero.buttonHref ?? "").trim() !== "" && !heroHrefSchema.safeParse((hero.buttonHref ?? "").trim()).success;
  const localeWrong = !localeSchema.safeParse(locale).success;
  const blocked =
    !dirty || keyLooksSecret || heroHrefWrong || localeWrong || priceWrong || internationalWrong || returnAddressWrong || returnAddressMissing || name.trim() === "";

  const submit = () => {
    if (priceCents === null) return;
    const input: SettingsInput = {
      name: name.trim(),
      currency,
      locale,
      stripePublishableKey: publishableKey.trim() || null,
      postcardPriceCents: priceCents,
      internationalPostcardPriceCents: internationalCents,
      returnAddress: returnAddressValue,
      cartRecoveryEnabled,
      cartRecoveryDelayHours,
      hero,
      theme,
    };

    update.mutate(input, {
      onSuccess: () => {
        saved.current = input;
        message.success("Saved.");
      },
      onError: (error: unknown) => void message.error(error instanceof Error ? error.message : "Could not save."),
    });
  };

  const saveButton = (
    <Button type="primary" disabled={blocked} loading={update.isPending} onClick={submit}>
      Save changes
    </Button>
  );

  return (
    <>
      <PageHeader title="Settings" description="The shop's name, the price of a postcard, and how it looks." actions={saveButton} />

      <Card title="Identity" className={cx(styles.card)}>
        <Field label="Store name" help="Shown in the banner, the page title, and every email.">
          {(control) => <Input {...control} value={name} onChange={(event) => setName(event.target.value)} />}
        </Field>

        <Field
          label="Price of one postcard"
          {...(priceWrong
            ? { error: "Enter an amount like 1.40. Stripe cannot charge less than 0.50." }
            : { help: "Charged per card: every design to every recipient. Changing it affects new orders only." })}
        >
          {(control) => (
            <Input
              {...control}
              className={cx(styles.currency)}
              value={price}
              prefix={currency === "USD" ? "$" : currency}
              status={priceWrong ? "error" : ""}
              onChange={(event) => setPrice(event.target.value)}
            />
          )}
        </Field>

        <Field label="Currency" help="Lob mails within the United States only, but the shop can charge in any currency Stripe supports.">
          {(control) => (
            <Select {...control} className={cx(styles.currency)} value={currency} onChange={setCurrency} showSearch options={CURRENCIES.map((code) => ({ label: code, value: code }))} />
          )}
        </Field>

        <Field
          label="Language"
          help={localeWrong ? "Use a language tag like en-US, de-DE or fr-CA." : `How the store writes numbers and dates. ${localeExample(locale, currency)}`}
        >
          {(control) => (
            <Select {...control} className={cx(styles.currency)} value={locale} onChange={setLocale} showSearch options={LOCALES} {...(localeWrong ? { status: "error" as const } : {})} />
          )}
        </Field>
      </Card>

      <Card title="Stripe" className={cx(styles.card)}>
        {environment.data ? (
          <p className={cx(styles.wiring)}>
            {environment.data.hasStripeSecret ? (
              <>
                Secret key configured on the server{" "}
                <Tag color={environment.data.stripeMode === "live" ? "red" : "blue"}>{environment.data.stripeMode} mode</Tag>
                {environment.data.hasWebhookSecret ? <Tag color="green">webhooks on</Tag> : <Tag color="orange">no webhook secret</Tag>}
              </>
            ) : (
              <>No secret key on the server, so nothing can be sold yet.</>
            )}
          </p>
        ) : null}

        <Field
          label="Publishable key"
          {...(keyLooksSecret
            ? { error: "That is a secret key. It must never be stored here — it would be sent to every shopper's browser." }
            : { help: "Public by design. The secret key lives only in the server's environment." })}
        >
          {(control) => (
            <Input {...control} value={publishableKey} placeholder="pk_test_…" status={keyLooksSecret ? "error" : ""} onChange={(event) => setPublishableKey(event.target.value)} />
          )}
        </Field>

        <p className={cx(styles.help)}>
          Discount codes are created in the Stripe dashboard; the checkout page accepts them.
        </p>
      </Card>

      <Card title="Printing" className={cx(styles.card)}>
        <PrintingCheck
          hasLob={environment.data?.hasLob ?? false}
          lobMode={environment.data?.lobMode ?? null}
        />

        <Field
          label="Price of a postcard mailed abroad"
          {...(internationalWrong
            ? { error: "Enter a price of at least 0.50, or leave it empty to mail within the United States only." }
            : { help: "Leave empty to mail within the United States only. Lob charges more to mail abroad, and international cards take about two weeks longer." })}
        >
          {(control) => (
            <Input
              {...control}
              className={cx(styles.currency)}
              prefix={currency === "USD" ? "$" : currency}
              inputMode="decimal"
              value={internationalPrice}
              placeholder="US only"
              status={internationalWrong ? "error" : ""}
              onChange={(event) => setInternationalPrice(event.target.value)}
            />
          )}
        </Field>

        <p className={cx(styles.help)}>
          <strong>Return address.</strong> Lob prints it on every card mailed abroad and will not send one
          without it, so international postcards need it. It must be in the United States.
          {returnAddressMissing ? " Add it below to turn international mail on." : ""}
        </p>
        <div className={cx(styles.returnAddress)}>
          <RecipientFields
            draft={returnAddress}
            errors={returnAddressErrors}
            locale={locale}
            allowInternational={false}
            onChange={(key, value) => {
              setReturnAddress((current) => ({ ...current, [key]: value }));
              if (returnAddressErrors[key]) setReturnAddressErrors((current) => ({ ...current, [key]: undefined }));
            }}
          />
        </div>
        {returnAddressWrong && returnAddressResult && !returnAddressResult.ok ? (
          <Alert
            className={cx(styles.notice)}
            type="error"
            showIcon
            title="The return address is incomplete"
            description={Object.values(returnAddressResult.errors).filter(Boolean).join(" ")}
          />
        ) : null}
      </Card>

      <Card title="Landing page" className={cx(styles.card)}>
        <p className={cx(styles.wiring)}>
          The opening block of your front page. Leave a field empty and the storefront falls back to
          the store name, the built-in line about scheduling postcards, and a button to the designer.
        </p>
        <HeroEditor value={hero} onChange={setHero} storeName={name} hrefWrong={heroHrefWrong} />
      </Card>

      <Card title="Email" className={cx(styles.card)}>
        <EmailCheck hasEmail={environment.data?.hasEmail ?? false} />
      </Card>

      <Card title="Abandoned cart recovery" className={cx(styles.card)}>
        <p className={cx(styles.wiring)}>
          One reminder email, sent once, to a signed-in customer with a verified address who leaves
          designs in their cart. It goes out under <strong>your own SMTP sending reputation</strong>.
        </p>

        <div className={cx(styles.toggleRow)}>
          <Switch checked={cartRecoveryEnabled} onChange={setCartRecoveryEnabled} aria-label="Send abandoned cart reminders" />
          <div>
            <p className={cx(styles.toggleLabel)}>{cartRecoveryEnabled ? "Sending cart reminders" : "Not sending cart reminders"}</p>
            <p className={cx(styles.help)}>
              {cartRecoveryEnabled
                ? "A customer who leaves designs untouched gets one email, with a link to recover their cart and an unsubscribe link."
                : "No cart data is collected or emailed while this is off."}
            </p>
          </div>
        </div>

        {cartRecoveryEnabled ? (
          <Field label="Wait before sending" help="Hours of inactivity before the one reminder goes out.">
            {(control) => (
              <InputNumber {...control} min={1} max={168} value={cartRecoveryDelayHours} onChange={(value) => setCartRecoveryDelayHours(value ?? 4)} suffix="hours" />
            )}
          </Field>
        ) : null}
      </Card>

      <Card title="Look" className={cx(styles.card)}>
        <ThemeEditor value={theme} onChange={setTheme} storeName={name} savedFontUrl={saved.current.theme.fontUrl} />
      </Card>

      <div className={cx(styles.footer)}>
        {saveButton}
        {dirty ? <span className={cx(styles.help)}>You have unsaved changes.</span> : null}
      </div>
    </>
  );
}

function HeroEditor({
  value,
  onChange,
  storeName,
  hrefWrong,
}: {
  value: Hero;
  onChange: (hero: Hero) => void;
  storeName: string;
  hrefWrong: boolean;
}) {
  const { message } = App.useApp();
  const upload = useUploadHeroImage();

  const set = <K extends keyof Hero>(key: K, next: Hero[K]) => onChange({ ...value, [key]: next });
  const setText = (key: "heading" | "text" | "buttonLabel" | "buttonHref", next: string) =>
    set(key, next.trim() === "" ? null : next);

  return (
    <>
      <Field label="Heading" help="Falls back to the store name.">
        {(control) => <Input {...control} value={value.heading ?? ""} placeholder={storeName || "Your store"} onChange={(event) => setText("heading", event.target.value)} />}
      </Field>

      <Field label="Text" help="One line under the heading.">
        {(control) => (
          <Input.TextArea {...control} value={value.text ?? ""} autoSize={{ minRows: 2 }} placeholder="Design your own postcards, send them to the people you love, and schedule them to arrive every few days." onChange={(event) => setText("text", event.target.value)} />
        )}
      </Field>

      <Field label="Button label" help="Falls back to “Let's go, I'm sold already”.">
        {(control) => <Input {...control} value={value.buttonLabel ?? ""} placeholder="Let's go, I'm sold already" onChange={(event) => setText("buttonLabel", event.target.value)} />}
      </Field>

      <Field
        label="Button link"
        {...(hrefWrong
          ? { error: "Use a path starting with / or a full https:// address." }
          : { help: "A path like /create, or a full https:// address. Falls back to /create." })}
      >
        {(control) => <Input {...control} value={value.buttonHref ?? ""} placeholder="/create" status={hrefWrong ? "error" : ""} onChange={(event) => setText("buttonHref", event.target.value)} />}
      </Field>

      <Field label="Photo" help="Beside the heading. Without one the built-in photo shows.">
        {() => (
          <Space>
            <Upload
              accept="image/*"
              showUploadList={false}
              beforeUpload={(file) => {
                upload.mutate(
                  { file, alt: "" },
                  {
                    onSuccess: (image) => set("image", image),
                    onError: () => void message.error("That image could not be uploaded."),
                  },
                );
                return Upload.LIST_IGNORE;
              }}
            >
              <Button icon={<UploadOutlined />} loading={upload.isPending}>
                {value.image ? "Replace" : "Upload"}
              </Button>
            </Upload>
            {value.image ? (
              <Button type="link" size="small" onClick={() => set("image", null)}>
                Remove
              </Button>
            ) : null}
          </Space>
        )}
      </Field>
    </>
  );
}

/**
 * Prove the SMTP transport works, before a customer does it for you.
 * Exported for its own test.
 */
export function EmailCheck({ hasEmail }: { hasEmail: boolean }) {
  const send = useSendTestEmail();

  return (
    <>
      <p className={cx(styles.wiring)}>
        {hasEmail
          ? "Order confirmations, 'your postcard was mailed' notices and password resets are sent over SMTP."
          : "No SMTP_URL on the server, so mail is written to the log instead of sent. Set SMTP_URL and EMAIL_FROM, then restart the API."}
      </p>

      <Button disabled={!hasEmail} loading={send.isPending} onClick={() => send.mutate()}>
        Send a test email
      </Button>

      {send.data ? (
        <Alert className={cx(styles.notice)} type={send.data.ok ? "success" : "error"} showIcon title={send.data.ok ? "Sent" : "The transport refused it"} description={send.data.message} />
      ) : null}

      {send.isError ? (
        <Alert className={cx(styles.notice)} type="error" showIcon title="Could not reach the server" description={send.error instanceof Error ? send.error.message : "Unknown error."} />
      ) : null}
    </>
  );
}

/**
 * Prove the printer works — the check v1 never had.
 *
 * Sends one card through the real pipeline to Lob's own test address and
 * shows whatever Lob said. With a test key nothing prints; with a live key
 * this costs one postcard, which the copy says before the button does it.
 * Exported for its own test.
 */
export function PrintingCheck({ hasLob, lobMode }: { hasLob: boolean; lobMode: "test" | "live" | null }) {
  const { modal } = App.useApp();
  const send = useSendTestPostcard();

  const run = () => send.mutate({ text: "This is a test postcard from the admin.", valediction: "— the printer check" });

  return (
    <>
      <p className={cx(styles.wiring)}>
        {hasLob ? (
          <>
            Postcards are printed and mailed by Lob{" "}
            <Tag color={lobMode === "live" ? "red" : "blue"}>{lobMode} key</Tag>
            The sweep runs every fifteen minutes and sends every card whose mailing day has come.
          </>
        ) : (
          "No LOB_API_KEY on the server, so paid orders wait at Scheduled and nothing is printed. Set it, then restart the API."
        )}
      </p>

      <Button
        disabled={!hasLob}
        loading={send.isPending}
        onClick={() => {
          if (lobMode === "live") {
            modal.confirm({
              title: "Send a real test postcard?",
              content: "This is a live Lob key, so a card will actually be printed and mailed to Lob's office, and it costs the usual postcard fee.",
              okText: "Send it",
              onOk: run,
            });
          } else {
            run();
          }
        }}
      >
        Send a test postcard
      </Button>

      {send.data ? (
        <Alert
          className={cx(styles.notice)}
          type={send.data.ok ? "success" : "error"}
          showIcon
          title={send.data.ok ? "Lob accepted it" : "Lob refused it"}
          description={
            <>
              {send.data.message}
              {send.data.url ? (
                <>
                  {" "}
                  <a href={send.data.url} target="_blank" rel="noreferrer">
                    See the rendered proof
                  </a>
                  .
                </>
              ) : null}
            </>
          }
        />
      ) : null}

      {send.isError ? (
        <Alert className={cx(styles.notice)} type="error" showIcon title="Could not reach the server" description={send.error instanceof Error ? send.error.message : "Unknown error."} />
      ) : null}
    </>
  );
}
