import { useRef, useState } from "react";
import { Alert, App, Button, Card, Input, Select, Skeleton, Space, Tag, Upload } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { SettingsInput } from "@shared/api";
import { formatMoney, parseCents } from "@shared/money";
import type { Recipient } from "@shared/postcards";
import { artistShareCents, defaultHero, defaultTheme, heroHrefSchema, localeSchema, type Hero, type Theme } from "@shared/schema";
import { BLANK_RECIPIENT, validateRecipient, type RecipientErrors } from "@/lib/recipient-form";
import { RecipientFields } from "@/components/postcard/RecipientFields";
import { cx } from "@/lib/cx";
import { useEnvironment, useSendTestEmail, useSendTestPostcard, useSettings, useUpdateSettings, useUploadHeroImage } from "./queries";
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

/** Platform settings. The form does not exist until the saved values are in hand. */
export function SettingsPage() {
  const settings = useSettings();


  if (settings.isPending) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (settings.isError || !settings.data) return <Alert type="error" showIcon title="Could not load your settings." />;

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
  const [printCost, setPrintCost] = useState((initial.pricing.printCostCents / 100).toFixed(2));
  const [fee, setFee] = useState((initial.pricing.platformFeeCents / 100).toFixed(2));
  const [minPrice, setMinPrice] = useState((initial.pricing.minMonthlyPriceCents / 100).toFixed(2));
  const [returnAddress, setReturnAddress] = useState<Recipient>(initial.returnAddress ?? BLANK_RECIPIENT);
  const [returnAddressErrors, setReturnAddressErrors] = useState<RecipientErrors>({});
  const [theme, setTheme] = useState<Theme>(initial.theme ?? defaultTheme);
  const [hero, setHero] = useState<Hero>(initial.hero ?? defaultHero);

  const saved = useRef(initial);
  const printCostCents = parseCents(printCost);
  const feeCents = parseCents(fee);
  const minPriceCents = parseCents(minPrice);
  const pricingWrong = printCostCents === null || feeCents === null || minPriceCents === null || minPriceCents < 50;
  const share = pricingWrong ? null : artistShareCents(minPriceCents, { printCostCents, platformFeeCents: feeCents });
  const shareWrong = share !== null && share <= 0;
  const money = (cents: number) => formatMoney(cents, currency, locale);

  const returnAddressTyped = [returnAddress.name, returnAddress.line1, returnAddress.city, returnAddress.state, returnAddress.postalCode].some((v) => v.trim() !== "");
  const returnAddressResult = returnAddressTyped ? validateRecipient({ ...returnAddress, country: "US" }) : null;
  const returnAddressWrong = returnAddressResult !== null && !returnAddressResult.ok;
  const returnAddressValue = returnAddressResult?.ok ? returnAddressResult.value : null;

  const pricing = pricingWrong ? null : { printCostCents, platformFeeCents: feeCents, minMonthlyPriceCents: minPriceCents };
  const dirty =
    name !== saved.current.name ||
    currency !== saved.current.currency ||
    locale !== saved.current.locale ||
    publishableKey !== (saved.current.stripePublishableKey ?? "") ||
    JSON.stringify(pricing) !== JSON.stringify(saved.current.pricing) ||
    JSON.stringify(returnAddressValue) !== JSON.stringify(saved.current.returnAddress) ||
    JSON.stringify(theme) !== JSON.stringify(saved.current.theme) ||
    JSON.stringify(hero) !== JSON.stringify(saved.current.hero);

  const keyLooksSecret = publishableKey.trim().startsWith("sk_");
  const heroHrefWrong = (hero.buttonHref ?? "").trim() !== "" && !heroHrefSchema.safeParse((hero.buttonHref ?? "").trim()).success;
  const localeWrong = !localeSchema.safeParse(locale).success;
  const blocked = !dirty || keyLooksSecret || heroHrefWrong || localeWrong || pricingWrong || shareWrong || returnAddressWrong || name.trim() === "";

  const submit = () => {
    if (!pricing) return;
    const input: SettingsInput = {
      name: name.trim(),
      currency,
      locale,
      stripePublishableKey: publishableKey.trim() || null,
      pricing,
      returnAddress: returnAddressValue,
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

  const cents = (value: string, set: (v: string) => void, label: string, help: string) => (
    <Field label={label} help={help}>
      {(control) => <Input {...control} className={cx(styles.currency)} value={value} prefix={currency === "USD" ? "$" : currency} inputMode="decimal" onChange={(event) => set(event.target.value)} />}
    </Field>
  );

  return (
    <>
      <PageHeader title="Settings" description="The platform's name, what a card costs and earns, and how the site looks." actions={saveButton} />

      <Card title="Identity" className={cx(styles.card)}>
        <Field label="Platform name" help="Shown in the banner, the page title, on the back of every card and in every email.">
          {(control) => <Input {...control} value={name} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <Field label="Currency" help="What subscribers are charged in and what artists are paid in. Every artist's price is in this currency.">
          {(control) => <Select {...control} className={cx(styles.currency)} value={currency} onChange={setCurrency} showSearch options={CURRENCIES.map((code) => ({ label: code, value: code }))} />}
        </Field>
        <Field label="Language" help={localeWrong ? "Use a language tag like en-US, de-DE or fr-CA." : "How the site writes numbers and dates."}>
          {(control) => <Select {...control} className={cx(styles.currency)} value={locale} onChange={setLocale} showSearch options={LOCALES} {...(localeWrong ? { status: "error" as const } : {})} />}
        </Field>
      </Card>

      <Card title="Pricing" className={cx(styles.card)}>
        <p className={cx(styles.wiring)}>
          Every card a subscriber is sent earns its artist the subscriber's monthly price less these two amounts. Changing them affects cards sent from now on; the ledger keeps what each past card was computed with.
        </p>
        {cents(printCost, setPrintCost, "What one printed and mailed card costs you", "Lob's per-card price for a 4×6 first-class postcard, plus whatever you want to allow for the odd reprint.")}
        {cents(fee, setFee, "What the platform keeps per card", "Your margin on each sent card.")}
        {cents(minPrice, setMinPrice, "The least an artist may charge a month", "Stripe cannot charge less than 0.50. Below your costs, a card would lose money.")}
        {pricingWrong ? (
          <Alert className={cx(styles.notice)} type="error" showIcon title="Enter amounts like 1.20, and a minimum price of at least 0.50." />
        ) : shareWrong ? (
          <Alert className={cx(styles.notice)} type="error" showIcon title="At the minimum price an artist would earn nothing" description="Raise the minimum, or lower the print cost or fee." />
        ) : (
          <p className={cx(styles.help)}>
            At the minimum price an artist earns {money(share ?? 0)} per card sent. At {money(500)} they would earn {money(artistShareCents(500, pricing!))}.
          </p>
        )}
      </Card>

      <Card title="Stripe" className={cx(styles.card)}>
        {environment.data ? (
          <p className={cx(styles.wiring)}>
            {environment.data.hasStripeSecret ? (
              <>
                Secret key configured on the server <Tag color={environment.data.stripeMode === "live" ? "red" : "blue"}>{environment.data.stripeMode} mode</Tag>
                {environment.data.hasWebhookSecret ? <Tag color="green">webhooks on</Tag> : <Tag color="orange">no webhook secret</Tag>}
              </>
            ) : (
              <>No secret key on the server, so nobody can subscribe and nobody can be paid.</>
            )}
          </p>
        ) : null}
        <Field label="Publishable key" {...(keyLooksSecret ? { error: "That is a secret key. It must never be stored here — it would be sent to every visitor's browser." } : { help: "Public by design. The secret key lives only in the server's environment." })}>
          {(control) => <Input {...control} value={publishableKey} placeholder="pk_test_…" status={keyLooksSecret ? "error" : ""} onChange={(event) => setPublishableKey(event.target.value)} />}
        </Field>
        <p className={cx(styles.help)}>Artists are paid through Stripe Connect Express accounts, which they set up from their studio. Enable Connect in your Stripe dashboard first.</p>
      </Card>

      <Card title="Printing" className={cx(styles.card)}>
        <PrintingCheck hasLob={environment.data?.hasLob ?? false} lobMode={environment.data?.lobMode ?? null} />
        <p className={cx(styles.help)}>
          <strong>Return address.</strong> Printed on every card mailed abroad — Lob will not send one without it — and where a domestic card comes back to if it cannot be delivered. It must be in the United States.
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
          <Alert className={cx(styles.notice)} type="error" showIcon title="The return address is incomplete" description={Object.values(returnAddressResult.errors).filter(Boolean).join(" ")} />
        ) : null}
      </Card>

      <Card title="Landing page" className={cx(styles.card)}>
        <p className={cx(styles.wiring)}>The opening block of the front page. Leave a field empty and the site falls back to "yes, i want a postcard", the built-in line, and a button to the artists.</p>
        <HeroEditor value={hero} onChange={setHero} hrefWrong={heroHrefWrong} />
      </Card>

      <Card title="Email" className={cx(styles.card)}>
        <EmailCheck hasEmail={environment.data?.hasEmail ?? false} />
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

function HeroEditor({ value, onChange, hrefWrong }: { value: Hero; onChange: (hero: Hero) => void; hrefWrong: boolean }) {
  const { message } = App.useApp();
  const upload = useUploadHeroImage();

  const set = <K extends keyof Hero>(key: K, next: Hero[K]) => onChange({ ...value, [key]: next });
  const setText = (key: "heading" | "text" | "buttonLabel" | "buttonHref", next: string) => set(key, next.trim() === "" ? null : next);

  return (
    <>
      <Field label="Heading" help="Falls back to the big lowercase “yes”.">
        {(control) => <Input {...control} value={value.heading ?? ""} placeholder="yes" onChange={(event) => setText("heading", event.target.value)} />}
      </Field>
      <Field label="Text" help="One line under the heading.">
        {(control) => <Input.TextArea {...control} value={value.text ?? ""} autoSize={{ minRows: 2 }} placeholder="an artist would like to send you a postcard." onChange={(event) => setText("text", event.target.value)} />}
      </Field>
      <Field label="Button label" help="Falls back to “YES I WANT A POSTCARD”.">
        {(control) => <Input {...control} value={value.buttonLabel ?? ""} placeholder="YES I WANT A POSTCARD" onChange={(event) => setText("buttonLabel", event.target.value)} />}
      </Field>
      <Field label="Button link" {...(hrefWrong ? { error: "Use a path starting with / or a full https:// address." } : { help: "A path like /artists, or a full https:// address. Falls back to /artists." })}>
        {(control) => <Input {...control} value={value.buttonHref ?? ""} placeholder="/artists" status={hrefWrong ? "error" : ""} onChange={(event) => setText("buttonHref", event.target.value)} />}
      </Field>
      <Field label="Photo" help="Beside the heading. Without one the built-in drawing of a postcard shows.">
        {() => (
          <Space>
            <Upload
              accept="image/*"
              showUploadList={false}
              beforeUpload={(file) => {
                upload.mutate({ file, alt: "" }, { onSuccess: (image) => set("image", image), onError: () => void message.error("That image could not be uploaded.") });
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

/** Prove the SMTP transport works, before a subscriber does it for you. */
export function EmailCheck({ hasEmail }: { hasEmail: boolean }) {
  const send = useSendTestEmail();

  return (
    <>
      <p className={cx(styles.wiring)}>
        {hasEmail
          ? "Welcome emails, 'your postcard was mailed' notices, artist notices and password resets are sent over SMTP."
          : "No SMTP_URL on the server, so mail is written to the log instead of sent. Set SMTP_URL and EMAIL_FROM, then restart the API."}
      </p>
      <Button disabled={!hasEmail} loading={send.isPending} onClick={() => send.mutate()}>
        Send a test email
      </Button>
      {send.data ? <Alert className={cx(styles.notice)} type={send.data.ok ? "success" : "error"} showIcon title={send.data.ok ? "Sent" : "The transport refused it"} description={send.data.message} /> : null}
      {send.isError ? <Alert className={cx(styles.notice)} type="error" showIcon title="Could not reach the server" description={send.error instanceof Error ? send.error.message : "Unknown error."} /> : null}
    </>
  );
}

/** Prove the printer works: one card through the real pipeline to Lob's own test address. */
export function PrintingCheck({ hasLob, lobMode }: { hasLob: boolean; lobMode: "test" | "live" | null }) {
  const { modal } = App.useApp();
  const send = useSendTestPostcard();
  const run = () => send.mutate({ text: "This is a test postcard from the admin.", valediction: "— the printer check" });

  return (
    <>
      <p className={cx(styles.wiring)}>
        {hasLob ? (
          <>
            Postcards are printed and mailed by Lob <Tag color={lobMode === "live" ? "red" : "blue"}>{lobMode} key</Tag>
            The sweep runs every fifteen minutes: due mailings become cards, and due cards go to Lob.
          </>
        ) : (
          "No LOB_API_KEY on the server, so mailings write cards that wait at Scheduled and nothing is printed. Set it, then restart the API."
        )}
      </p>
      <Button
        disabled={!hasLob}
        loading={send.isPending}
        onClick={() => {
          if (lobMode === "live") {
            modal.confirm({ title: "Send a real test postcard?", content: "This is a live Lob key, so a card will actually be printed and mailed to Lob's office, and it costs the usual postcard fee.", okText: "Send it", onOk: run });
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
      {send.isError ? <Alert className={cx(styles.notice)} type="error" showIcon title="Could not reach the server" description={send.error instanceof Error ? send.error.message : "Unknown error."} /> : null}
    </>
  );
}
