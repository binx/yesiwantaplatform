import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  InputNumber,
  Select,
  Skeleton,
  Space,
  Switch,
  Tag,
  Upload,
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { SettingsInput } from "@shared/api";
import { formatMoney } from "@shared/money";
import {
  DEFAULT_TAX_CODE,
  defaultHero,
  defaultTheme,
  heroHrefSchema,
  localeSchema,
  type Hero,
  type TaxBehavior,
  type Theme,
} from "@shared/schema";
import { cx } from "@/lib/cx";
import {
  useClearStorefrontPassword,
  useCreateShareLink,
  useEnvironment,
  useProducts,
  useRevokeShareLink,
  useSendTestEmail,
  useSetStorefrontPassword,
  useSettings,
  useShipping,
  useStorefrontStatus,
  useUpdateSettings,
  useUpdateStorefrontAccess,
  useUploadHeroImage,
} from "./queries";
import { computeGoLiveRows } from "./goLive";
import { Field } from "./Field";
import { PageHeader } from "./RequireAdmin";
import { ThemeEditor } from "./ThemeEditor";
import styles from "./SettingsPage.module.css";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "SEK", "NZD", "CHF", "DKK"];

/**
 * The tags a store is most likely to want, named rather than coded.
 *
 * A short list with a free-text fallback, not an exhaustive one: `Intl`
 * accepts hundreds of tags and a merchant who needs `pt-BR` can type it, while
 * a dropdown of hundreds helps nobody find `de-DE`. The select is `showSearch`
 * with a free-text entry for exactly that reason.
 */
const LOCALES = [
  { value: "en-US", label: "English (United States) — en-US" },
  { value: "en-GB", label: "English (United Kingdom) — en-GB" },
  { value: "en-CA", label: "English (Canada) — en-CA" },
  { value: "en-AU", label: "English (Australia) — en-AU" },
  { value: "de-DE", label: "German (Germany) — de-DE" },
  { value: "fr-FR", label: "French (France) — fr-FR" },
  { value: "es-ES", label: "Spanish (Spain) — es-ES" },
  { value: "it-IT", label: "Italian (Italy) — it-IT" },
  { value: "nl-NL", label: "Dutch (Netherlands) — nl-NL" },
  { value: "pt-BR", label: "Portuguese (Brazil) — pt-BR" },
  { value: "sv-SE", label: "Swedish (Sweden) — sv-SE" },
  { value: "da-DK", label: "Danish (Denmark) — da-DK" },
  { value: "ja-JP", label: "Japanese (Japan) — ja-JP" },
];

/**
 * What this language actually does to a price, in that language.
 *
 * A tag is an abstraction — `de-DE` tells a merchant nothing about where the
 * comma goes. Showing the formatted result is the whole explanation, and it is
 * the same call the storefront makes, so it cannot promise something the shop
 * does not then render.
 */
function localeExample(locale: string, currency: string): string {
  try {
    return `Prices read ${formatMoney(123456, currency, locale)}.`;
  } catch {
    // An unusable pair should not take the settings form down with it; the
    // field is already flagged by `localeWrong` above.
    return "";
  }
}

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
  const [locale, setLocale] = useState(initial.locale);
  const [publishableKey, setPublishableKey] = useState(initial.stripePublishableKey ?? "");
  const [aboutText, setAboutText] = useState(initial.aboutText ?? "");
  const [taxEnabled, setTaxEnabled] = useState(initial.taxEnabled);
  const [taxBehavior, setTaxBehavior] = useState<TaxBehavior>(initial.taxBehavior);
  const [defaultTaxCode, setDefaultTaxCode] = useState(initial.defaultTaxCode);
  const [cartRecoveryEnabled, setCartRecoveryEnabled] = useState(initial.cartRecoveryEnabled);
  const [cartRecoveryDelayHours, setCartRecoveryDelayHours] = useState(
    initial.cartRecoveryDelayHours,
  );
  const [theme, setTheme] = useState<Theme>(initial.theme ?? defaultTheme);
  const [hero, setHero] = useState<Hero>(initial.hero ?? defaultHero);

  const saved = useRef(initial);

  const dirty =
    name !== saved.current.name ||
    currency !== saved.current.currency ||
    locale !== saved.current.locale ||
    publishableKey !== (saved.current.stripePublishableKey ?? "") ||
    aboutText !== (saved.current.aboutText ?? "") ||
    taxEnabled !== saved.current.taxEnabled ||
    taxBehavior !== saved.current.taxBehavior ||
    defaultTaxCode !== saved.current.defaultTaxCode ||
    cartRecoveryEnabled !== saved.current.cartRecoveryEnabled ||
    cartRecoveryDelayHours !== saved.current.cartRecoveryDelayHours ||
    JSON.stringify(theme) !== JSON.stringify(saved.current.theme) ||
    JSON.stringify(hero) !== JSON.stringify(saved.current.hero);

  const keyLooksSecret = publishableKey.trim().startsWith("sk_");
  /*
   * Checked against the shared schema, not a second regex here.
   *
   * The value ends up in an `href` rendered to every shopper, so the browser
   * and the server have to refuse exactly the same strings — see
   * `heroHrefSchema`. Save is blocked while it is wrong rather than the server
   * rejecting a form the merchant already thought was fine.
   */
  const heroHrefWrong =
    (hero.buttonHref ?? "").trim() !== "" &&
    !heroHrefSchema.safeParse((hero.buttonHref ?? "").trim()).success;
  const currencyChanged = currency !== initial.currency;
  // Validated against the shared schema, which is the same check the server
  // runs — the select's own options always pass, but the field takes free text.
  const localeWrong = !localeSchema.safeParse(locale).success;
  const taxCodeLooksWrong =
    defaultTaxCode.trim() !== "" && !/^txcd_[0-9]+$/.test(defaultTaxCode.trim());
  // Immutable on a Stripe Price, so this is not a setting that quietly applies
  // to what is already published — see the warning below.
  const behaviorChanged = taxEnabled && taxBehavior !== initial.taxBehavior;

  const submit = () => {
    const input: SettingsInput = {
      name: name.trim(),
      currency,
      locale,
      stripePublishableKey: publishableKey.trim() || null,
      // Empty means "no About page", which is a real choice — but it can only
      // be reached by clearing the field, never by the form never having been
      // filled in.
      aboutText: aboutText.trim() || null,
      taxEnabled,
      taxBehavior,
      defaultTaxCode: defaultTaxCode.trim() || DEFAULT_TAX_CODE,
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
            disabled={
            !dirty ||
            keyLooksSecret ||
            taxCodeLooksWrong ||
            heroHrefWrong ||
            localeWrong ||
            name.trim() === ""
          }
            loading={update.isPending}
            onClick={submit}
          >
            Save changes
          </Button>
        }
      />

      <VisibilityCard />

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

        <Field
          label="Language"
          help={
            localeWrong
              ? "Use a language tag like en-US, de-DE or fr-CA."
              : `How the store writes numbers and dates. ${localeExample(locale, currency)}`
          }
        >
          {(control) => (
            <Select
              {...control}
              className={cx(styles.currency)}
              value={locale}
              onChange={setLocale}
              showSearch
              /*
               * Free text as well as the list: `Intl` accepts far more tags
               * than belong in a dropdown, and a shop in a place this list
               * forgot should not be stuck with American separators. What it
               * types is validated the same way the server validates it.
               */
              options={LOCALES}
              {...(localeWrong ? { status: "error" as const } : {})}
            />
          )}
        </Field>
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

      <Card title="Landing page" className={cx(styles.card)}>
        <p className={cx(styles.wiring)}>
          The opening block of your front page. Leave a field empty and the storefront falls
          back to what it showed before — the store name, no paragraph, and a{" "}
          <strong>Shop everything</strong> button.
        </p>

        <HeroEditor
          value={hero}
          onChange={setHero}
          storeName={name}
          hrefWrong={heroHrefWrong}
        />
      </Card>

      <Card title="Email" className={cx(styles.card)}>
        <EmailCheck hasEmail={environment.data?.hasEmail ?? false} />
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

      <Card title="Abandoned cart recovery" className={cx(styles.card)}>
        <p className={cx(styles.wiring)}>
          One reminder email, sent once, to a signed-in customer with a verified address who
          leaves items in their cart. It goes out under <strong>your own SMTP sending
          reputation</strong>, not ours — Beluga sends nothing on your behalf until this is on.
        </p>

        <div className={cx(styles.toggleRow)}>
          <Switch
            checked={cartRecoveryEnabled}
            onChange={setCartRecoveryEnabled}
            aria-label="Send abandoned cart reminders"
          />
          <div>
            <p className={cx(styles.toggleLabel)}>
              {cartRecoveryEnabled ? "Sending cart reminders" : "Not sending cart reminders"}
            </p>
            <p className={cx(styles.help)}>
              {cartRecoveryEnabled
                ? "A customer who leaves items untouched gets one email, with a link to recover their cart and an unsubscribe link."
                : "No cart data is collected or emailed while this is off."}
            </p>
          </div>
        </div>

        {cartRecoveryEnabled ? (
          <Field
            label="Wait before sending"
            help="Hours of inactivity before the one reminder goes out."
          >
            {(control) => (
              // `suffix` rather than `addonAfter`, which antd 6 deprecates in
              // favour of Space.Compact — but a unit is not a second control,
              // and the suffix keeps it inside the field where it belongs.
              <InputNumber
                {...control}
                min={1}
                max={168}
                value={cartRecoveryDelayHours}
                onChange={(value) => setCartRecoveryDelayHours(value ?? 4)}
                suffix="hours"
              />
            )}
          </Field>
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
        <ThemeEditor
          value={theme}
          onChange={setTheme}
          storeName={name}
          savedFontUrl={saved.current.theme.fontUrl}
        />
      </Card>

      <div className={cx(styles.footer)}>
        <Button
          type="primary"
          disabled={
            !dirty || keyLooksSecret || taxCodeLooksWrong || heroHrefWrong || name.trim() === ""
          }
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

/**
 * Who can see the storefront — see docs/tasks/27-storefront-preview-mode.md.
 *
 * Built in the shape of the Tax card above: a paragraph saying what the
 * feature does and does not do, an always-visible checklist of what should be
 * true before flipping the switch, and a toggle row whose label states the
 * current state as a fact rather than naming the action.
 *
 * Its own card rather than folded into the identity form: none of this goes
 * through `settingsInputSchema`, on purpose — see the security note in the
 * brief. Nothing here participates in the page's `dirty`/Save machinery.
 */
function VisibilityCard() {
  const { message, modal } = App.useApp();
  const status = useStorefrontStatus();
  const environment = useEnvironment();
  const products = useProducts();
  const shipping = useShipping();

  const updateAccess = useUpdateStorefrontAccess();
  const setPassword = useSetStorefrontPassword();
  const clearPassword = useClearStorefrontPassword();
  const createLink = useCreateShareLink();
  const revokeLink = useRevokeShareLink();

  const [passwordDraft, setPasswordDraft] = useState("");
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [shareLinkUrl, setShareLinkUrl] = useState<string | null>(null);

  if (status.isPending || !status.data) {
    return (
      <Card title="Visibility" className={cx(styles.card)}>
        <Skeleton active paragraph={{ rows: 4 }} />
      </Card>
    );
  }

  const data = status.data;
  const isPublic = data.access === "public";

  const rows = computeGoLiveRows({
    environment: {
      hasStripeSecret: environment.data?.hasStripeSecret ?? false,
      stripeMode: environment.data?.stripeMode ?? null,
      hasWebhookSecret: environment.data?.hasWebhookSecret ?? false,
      hasEmail: environment.data?.hasEmail ?? false,
      publicUrl: environment.data?.publicUrl ?? "",
    },
    shipping: shipping.data,
    products: products.data,
  });
  const failing = rows.filter((row) => !row.ok);

  const fail = (fallback: string) => (error: unknown) =>
    void message.error(error instanceof Error ? error.message : fallback);

  const goPublic = () => {
    updateAccess.mutate(
      { access: "public" },
      {
        onSuccess: () => void message.success("This store is open."),
        onError: fail("Could not open the store."),
      },
    );
  };

  /**
   * Nothing on the checklist blocks this — a merchant does not get told they
   * are not ready to open their own shop. The confirmation lists only what is
   * failing, collapsed to a count for the rest: a merchant who has read this
   * card all week does not need the passing rows read back to them.
   */
  const requestOpen = () => {
    if (failing.length === 0) {
      goPublic();
      return;
    }

    modal.confirm({
      title: "Open the store?",
      okText: "Open anyway",
      content: (
        <>
          <p>
            {failing.length} of {rows.length} things on the checklist{" "}
            {failing.length === 1 ? "is not" : "are not"} done yet:
          </p>
          <ul>
            {failing.map((row) => (
              <li key={row.key}>{row.label}</li>
            ))}
          </ul>
        </>
      ),
      onOk: goPublic,
    });
  };

  const requirePassword = () => {
    if (data.hasPassword) {
      updateAccess.mutate(
        { access: "password" },
        {
          onSuccess: () => void message.success("A password is now required."),
          onError: fail("Could not lock the store."),
        },
      );
      return;
    }
    // access: "password" with no password set means nothing — the server
    // refuses it with a 409, so a password is collected first here instead.
    setShowPasswordField(true);
  };

  const savePassword = () => {
    if (passwordDraft.length < 8) {
      void message.error("Use at least 8 characters.");
      return;
    }

    setPassword.mutate(passwordDraft, {
      onSuccess: () => {
        setPasswordDraft("");
        setShowPasswordField(false);
        message.success(isPublic ? "Password set." : "Password changed. Every existing viewer is signed out.");
        if (isPublic) {
          updateAccess.mutate({ access: "password" }, { onError: fail("Could not lock the store.") });
        }
      },
      onError: fail("Could not set that password."),
    });
  };

  return (
    <Card title="Visibility" className={cx(styles.card)}>
      <p className={cx(styles.wiring)}>
        Who can see the storefront. This does not touch Stripe, email or the catalogue — it only
        decides who is allowed to look while the rest of it is being built.
      </p>

      <Alert
        className={cx(styles.notice)}
        type="info"
        showIcon
        title="Before opening to everyone"
        description={
          <ul className={cx(styles.checklist)}>
            {rows.map((row) => (
              <li key={row.key}>
                {row.label}
                {!row.ok ? (
                  <>
                    {" — "}
                    {row.href ? <Link to={row.href}>{row.hint}</Link> : row.hint}
                  </>
                ) : (
                  " — done"
                )}
              </li>
            ))}
          </ul>
        }
      />

      <div className={cx(styles.toggleRow)}>
        <Switch
          checked={isPublic}
          onChange={(checked) => (checked ? requestOpen() : requirePassword())}
          aria-label="Open to everyone"
        />
        <div>
          <p className={cx(styles.toggleLabel)}>
            {isPublic ? "Open to everyone" : "Password required"}
          </p>
          <p className={cx(styles.help)}>
            {isPublic
              ? "Anyone with the address can browse and buy."
              : "A visitor has to enter the password below, or use a share link, before they see anything."}
          </p>
        </div>
      </div>

      {!isPublic || showPasswordField ? (
        <Field
          label={data.hasPassword ? "Change the password" : "Set a password"}
          help="At least 8 characters. Give it to whoever should be able to preview the store."
        >
          {(control) => (
            <Space.Compact style={{ width: "100%" }}>
              <Input.Password
                {...control}
                value={passwordDraft}
                onChange={(event) => setPasswordDraft(event.target.value)}
                placeholder="Storefront password"
                onPressEnter={savePassword}
              />
              <Button type="primary" loading={setPassword.isPending} onClick={savePassword}>
                Save
              </Button>
            </Space.Compact>
          )}
        </Field>
      ) : null}

      {data.hasPassword ? (
        <Button
          size="small"
          onClick={() => {
            modal.confirm({
              title: "Remove the storefront password?",
              content: "The store becomes open to everyone immediately.",
              okText: "Remove password",
              okButtonProps: { danger: true },
              onOk: () => {
                clearPassword.mutate(undefined, {
                  onSuccess: () =>
                    void message.success("Password removed. The store is open to everyone."),
                  onError: fail("Could not remove the password."),
                });
              },
            });
          }}
        >
          Remove password
        </Button>
      ) : null}

      <Field
        label="Share link"
        help="Unlocks the store for one recipient without the password — a client or a collaborator. Minting a new one replaces the old."
      >
        {() => (
          <Space>
            <Button
              loading={createLink.isPending}
              onClick={() =>
                createLink.mutate(undefined, {
                  onSuccess: (result) => {
                    setShareLinkUrl(result.url);
                    message.success("Share link created. Copy it now.");
                  },
                  onError: fail("Could not create a share link."),
                })
              }
            >
              {data.hasShareLink ? "Create a new link" : "Create a share link"}
            </Button>

            {data.hasShareLink ? (
              <Button
                size="small"
                loading={revokeLink.isPending}
                onClick={() => {
                  modal.confirm({
                    title: "Revoke the share link?",
                    content: "Anyone using it will need the password, or a new link, to get back in.",
                    okText: "Revoke",
                    okButtonProps: { danger: true },
                    onOk: () => {
                      revokeLink.mutate(undefined, {
                        onSuccess: () => {
                          setShareLinkUrl(null);
                          message.success("Share link revoked.");
                        },
                        onError: fail("Could not revoke that link."),
                      });
                    },
                  });
                }}
              >
                Revoke
              </Button>
            ) : null}
          </Space>
        )}
      </Field>

      {shareLinkUrl ? (
        <Alert
          className={cx(styles.notice)}
          type="info"
          showIcon
          title="Share link"
          description={
            <>
              <p style={{ marginTop: 0 }}>
                Shown once. It is not stored anywhere you can read it back — send it now; minting
                a new one later replaces it.
              </p>
              <code>{shareLinkUrl}</code>
            </>
          }
        />
      ) : null}
    </Card>
  );
}

/**
 * The landing page's opening block.
 *
 * Plain text, deliberately — a hero is one sentence, and a bold word inside it
 * is a decision the theme should be making, not the merchant. Everything here
 * is optional: the placeholders show what the storefront renders when a field
 * is left empty, so the fallbacks are visible rather than something to
 * discover by saving and looking.
 */
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

  const set = <K extends keyof Hero>(key: K, next: Hero[K]) =>
    onChange({ ...value, [key]: next });

  /** "" is how a cleared input arrives; null is how the store says "default". */
  const setText = (key: "heading" | "text" | "buttonLabel" | "buttonHref", next: string) =>
    set(key, next.trim() === "" ? null : next);

  return (
    <>
      <Field label="Heading" help="Falls back to the store name.">
        {(control) => (
          <Input
            {...control}
            value={value.heading ?? ""}
            placeholder={storeName || "Your store"}
            onChange={(event) => setText("heading", event.target.value)}
          />
        )}
      </Field>

      <Field label="Text" help="One line under the heading. Leave empty to show none.">
        {(control) => (
          <Input.TextArea
            {...control}
            value={value.text ?? ""}
            autoSize={{ minRows: 2 }}
            placeholder="Small runs, made to be used."
            onChange={(event) => setText("text", event.target.value)}
          />
        )}
      </Field>

      <Field label="Button label" help="Falls back to “Shop everything”.">
        {(control) => (
          <Input
            {...control}
            value={value.buttonLabel ?? ""}
            placeholder="Shop everything"
            onChange={(event) => setText("buttonLabel", event.target.value)}
          />
        )}
      </Field>

      <Field
        label="Button link"
        {...(hrefWrong
          ? {
              error:
                "Use a path starting with / or a full https:// address. Anything else could send shoppers somewhere this store does not control.",
            }
          : { help: "A path like /shop, or a full https:// address. Falls back to /shop." })}
      >
        {(control) => (
          <Input
            {...control}
            value={value.buttonHref ?? ""}
            placeholder="/shop"
            status={hrefWrong ? "error" : ""}
            onChange={(event) => setText("buttonHref", event.target.value)}
          />
        )}
      </Field>

      <Field
        label="Background image"
        help="Sits full-bleed behind the hero. Without one the themed background shows."
      >
        {() => (
          <Space>
            <Upload
              accept="image/*"
              showUploadList={false}
              beforeUpload={(file) => {
                upload.mutate(
                  // Decorative: the heading beside it already carries the
                  // meaning, and describing a background twice is noise in a
                  // screen reader.
                  { file, alt: "" },
                  {
                    onSuccess: (image) => set("image", image),
                    onError: () => void message.error("That image could not be uploaded."),
                  },
                );
                // Handed to the mutation above; antd's own uploader stays out.
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
 *
 * `SMTP_URL` being set is not the same as email working, and every send in
 * this codebase swallows its failure on purpose — an order email must not fail
 * a payment Stripe has already taken. So a wrong port, a sender the provider
 * will not accept, or an authentication failure all look exactly like success
 * from here until someone does not receive their confirmation. One button that
 * reports the transport's own answer closes that gap.
 *
 * It always sends to the signed-in administrator: the server takes no address
 * from the request, so this cannot become a way to mail strangers over the
 * merchant's own SMTP reputation.
 *
 * Exported for its own test: reaching it through the whole Settings page would
 * mean mocking every query that page loads to assert one button.
 */
export function EmailCheck({ hasEmail }: { hasEmail: boolean }) {
  const send = useSendTestEmail();

  return (
    <>
      <p className={cx(styles.wiring)}>
        {hasEmail
          ? "Order confirmations, password resets and staff invitations are sent over SMTP."
          : "No SMTP_URL on the server, so mail is written to the log instead of sent. Set SMTP_URL and EMAIL_FROM, then restart the API."}
      </p>

      <Button disabled={!hasEmail} loading={send.isPending} onClick={() => send.mutate()}>
        Send a test email
      </Button>

      {send.data ? (
        <Alert
          className={cx(styles.notice)}
          type={send.data.ok ? "success" : "error"}
          showIcon
          title={send.data.ok ? "Sent" : "The transport refused it"}
          description={send.data.message}
        />
      ) : null}

      {send.isError ? (
        <Alert
          className={cx(styles.notice)}
          type="error"
          showIcon
          title="Could not reach the server"
          description={send.error instanceof Error ? send.error.message : "Unknown error."}
        />
      ) : null}
    </>
  );
}
