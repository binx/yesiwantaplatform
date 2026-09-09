import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  ConfigProvider,
  Form,
  Input,
  Result,
  Select,
  Skeleton,
  Steps,
  Tag,
  Typography,
} from "antd";
import { CheckCircleTwoTone, InfoCircleOutlined } from "@ant-design/icons";
import { defaultTheme, type Theme } from "@shared/schema";
import type { SessionResponse, SetupInput } from "@shared/api";
import { csrfPost, setCsrfToken } from "@/lib/api";
import { sessionQueryKey, setupStatusQueryKey, useSetupStatus } from "@/lib/session";
import { ThemeEditor } from "./ThemeEditor";
import { adminTheme } from "./adminTheme";
import { cx } from "@/lib/cx";
import { isLocalOrigin } from "@/lib/publicUrl";
import styles from "./SetupPage.module.css";

/**
 * First run.
 *
 * v1's onboarding was: clone, `npm run server`, uncaught ENOENT because
 * `config.env` did not exist, hand-author that file from reading the source,
 * restart, meet a two-field modal, then find a five-tab configuration page.
 * This is three steps and ends signed in.
 *
 * One thing it deliberately cannot do is take a Stripe *secret* key. A browser
 * form that accepted one would have to post it to the server to be written to
 * disk, and the server would have to write its own configuration file to store
 * it — which is exactly what v1 did, and why its secrets and its config were
 * the same mutable file. The secret key stays an environment variable, and
 * this page reports whether the server already has one.
 */

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "SEK", "NZD", "CHF", "DKK"];

interface IdentityValues {
  /** Only when the server printed one at boot — see `requiresToken` below. */
  setupToken?: string;
  storeName: string;
  currency: string;
  email: string;
  password: string;
  confirm: string;
}

interface WizardState {
  step: number;
  identity: IdentityValues | null;
  publishableKey: string;
  theme: Theme;
  seedDemo: boolean;
  lockStorefront: boolean | null;
  storefrontPassword: string;
}

// Adding a Stripe key means editing `.env` and restarting the API, which is
// reason enough to reload the tab. sessionStorage survives that reload, so
// the admin account you already typed on step 1 doesn't vanish for it.
const WIZARD_STORAGE_KEY = "beluga:setup-wizard";

function loadWizardState(): WizardState | null {
  try {
    const raw = sessionStorage.getItem(WIZARD_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WizardState) : null;
  } catch {
    return null;
  }
}

function saveWizardState(state: WizardState) {
  try {
    sessionStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private browsing or storage disabled: the wizard still works, it just
    // won't survive a reload.
  }
}

function clearWizardState() {
  try {
    sessionStorage.removeItem(WIZARD_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Themed like the admin, not like the store.
 *
 * This is a sibling of `/admin` in the router rather than a child of it, so it
 * never saw `AdminRoot`'s `ConfigProvider` and rendered under antd's stock
 * theme instead. That theme's `colorTextDescription` (#8c8c8c, 3.36:1) and
 * `colorPrimary` (#1677ff, 4.1:1 under white) both fail WCAG AA, which put
 * real contrast violations on the not-yet-reached step titles, every field's
 * help text, and the primary button — on the first page a new operator sees.
 * `AntApp` comes with it so `ThemeEditor`'s upload errors have somewhere to go.
 *
 * The store's own palette is deliberately not used here, for the same reason
 * the admin does not use it: the wizard is where that palette is being chosen,
 * and a half-chosen one must not be able to make this page unreadable.
 * `ThemeEditor` scopes the live preview to its own nested provider.
 */
export function SetupPage() {
  return (
    <ConfigProvider theme={adminTheme}>
      <AntApp>
        <SetupWizard />
      </AntApp>
    </ConfigProvider>
  );
}

function SetupWizard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useSetupStatus();

  const [saved] = useState(loadWizardState);
  const [step, setStep] = useState(saved?.step ?? 0);
  const [identity, setIdentity] = useState<IdentityValues | null>(saved?.identity ?? null);
  const [publishableKey, setPublishableKey] = useState(saved?.publishableKey ?? "");
  const [theme, setTheme] = useState<Theme>(saved?.theme ?? defaultTheme);
  const [seedDemo, setSeedDemo] = useState(saved?.seedDemo ?? true);
  const [lockStorefrontChoice, setLockStorefrontChoice] = useState<boolean | null>(
    saved?.lockStorefront ?? null,
  );
  const [storefrontPassword, setStorefrontPassword] = useState(saved?.storefrontPassword ?? "");

  // Reported by the server, never editable here — see the note on the last step.
  const publicUrl = status.data?.publicUrl ?? null;

  /*
   * Default the answer to "lock it" once the public URL is known and is not
   * localhost — see docs/tasks/27-storefront-preview-mode.md §1. A fresh
   * public address is port-scanned within minutes, and this is precisely the
   * case where the store is reachable before it is finished. Only sets the
   * default the first time; a choice already made (including by loading a
   * saved wizard session) is never overwritten.
   */
  useEffect(() => {
    if (lockStorefrontChoice !== null || !publicUrl) return;
    setLockStorefrontChoice(!isLocalOrigin(publicUrl));
  }, [publicUrl, lockStorefrontChoice]);

  useEffect(() => {
    saveWizardState({
      step,
      identity,
      publishableKey,
      theme,
      seedDemo,
      lockStorefront: lockStorefrontChoice,
      storefrontPassword,
    });
  }, [step, identity, publishableKey, theme, seedDemo, lockStorefrontChoice, storefrontPassword]);

  useEffect(() => {
    document.title = "Set up your store · Beluga";
  }, []);

  const submit = useMutation({
    mutationFn: (input: SetupInput) => csrfPost<SessionResponse>("/setup", input),
    onSuccess: async (session) => {
      clearWizardState();
      setCsrfToken(session.csrfToken);
      queryClient.setQueryData(sessionQueryKey, session);
      await queryClient.invalidateQueries({ queryKey: setupStatusQueryKey });
      // The storefront's cached "no store here" answer is now wrong.
      await queryClient.invalidateQueries({ queryKey: ["store"] });
    },
  });

  if (status.isPending) {
    return (
      <main className={cx(styles.page)}>
        <Card className={cx(styles.card)}>
          <Skeleton active paragraph={{ rows: 5 }} />
        </Card>
      </main>
    );
  }

  // Someone else finished setup, or this tab was left open across it.
  if (status.data && !status.data.needsSetup && !submit.isSuccess) {
    clearWizardState();
    return <Navigate to="/admin" replace />;
  }

  if (submit.isSuccess) {
    return (
      <main className={cx(styles.page)}>
        <Card className={cx(styles.card)}>
          <Result
            status="success"
            title={`${identity?.storeName ?? "Your store"} is ready`}
            subTitle={
              submit.data.isAdmin
                ? "You are signed in as its administrator."
                : "An administrator already existed, so sign in with that account."
            }
            extra={[
              <Button
                key="admin"
                type="primary"
                onClick={() => void navigate(submit.data.isAdmin ? "/admin" : "/admin/login")}
              >
                {submit.data.isAdmin ? "Open the admin" : "Sign in"}
              </Button>,
              <Button key="store" onClick={() => void navigate("/")}>
                View the storefront
              </Button>,
            ]}
          />
        </Card>
      </main>
    );
  }

  const lockStorefront = Boolean(lockStorefrontChoice) && storefrontPassword.length >= 8;

  const finish = () => {
    if (!identity) return;

    submit.mutate({
      storeName: identity.storeName,
      currency: identity.currency,
      email: identity.email,
      password: identity.password,
      stripePublishableKey: publishableKey.trim() || null,
      theme,
      seedDemo,
      lockStorefront,
      ...(lockStorefront ? { storefrontPassword } : {}),
      ...(identity.setupToken?.trim() ? { setupToken: identity.setupToken.trim() } : {}),
    });
  };

  return (
    <main className={cx(styles.page)}>
      <Card className={cx(styles.card)}>
        <Typography.Title level={1} className={cx(styles.title)}>
          <span aria-hidden="true">🎷🐋</span> Set up your store
        </Typography.Title>
        <p className={cx(styles.subtitle)}>Three steps. Nothing is saved until the last one.</p>

        <Steps
          className={cx(styles.steps)}
          current={step}
          size="small"
          items={[{ title: "Store" }, { title: "Payments" }, { title: "Look" }]}
        />

        {submit.isError ? (
          <Alert
            className={cx(styles.alert)}
            type="error"
            showIcon
            title={submit.error instanceof Error ? submit.error.message : "Setup failed."}
          />
        ) : null}

        {step === 0 ? (
          <IdentityStep
            initial={identity}
            requiresToken={status.data?.requiresToken ?? false}
            onDone={(values) => {
              setIdentity(values);
              setStep(1);
            }}
          />
        ) : null}

        {step === 1 ? (
          <PaymentsStep
            hasSecret={status.data?.hasStripeSecret ?? false}
            mode={status.data?.stripeMode ?? null}
            value={publishableKey}
            onChange={setPublishableKey}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
          />
        ) : null}

        {step === 2 ? (
          <>
            <ThemeEditor
              value={theme}
              onChange={setTheme}
              storeName={identity?.storeName ?? "Your store"}
              // Nothing is saved yet, so any font URL typed here is one the
              // store's CSP does not allow — which is exactly what the note in
              // the preview should say.
              savedFontUrl={null}
            />

            <Checkbox
              className={cx(styles.seed)}
              checked={seedDemo}
              onChange={(event) => setSeedDemo(event.target.checked)}
            >
              Load the demo catalogue, so the storefront has something to render
            </Checkbox>

            {/*
             * See docs/tasks/27-storefront-preview-mode.md §1. The default is
             * computed once the public URL is known, above — not repeated
             * here, so this checkbox is never fighting a re-render of its own
             * default.
             */}
            <Checkbox
              className={cx(styles.seed)}
              checked={lockStorefrontChoice ?? false}
              onChange={(event) => setLockStorefrontChoice(event.target.checked)}
            >
              Put a password on the storefront until I am ready to open it
            </Checkbox>

            {lockStorefrontChoice ? (
              <Form layout="vertical" requiredMark={false}>
                <Form.Item
                  label="Storefront password"
                  help="At least 8 characters. Give it to anyone who should be able to preview the store before it opens."
                  validateStatus={
                    storefrontPassword.length > 0 && storefrontPassword.length < 8 ? "error" : ""
                  }
                >
                  <Input.Password
                    value={storefrontPassword}
                    onChange={(event) => setStorefrontPassword(event.target.value)}
                    autoComplete="new-password"
                    size="large"
                  />
                </Form.Item>
              </Form>
            ) : null}

            {/*
              * Said, not fixed.
              *
              * This wizard writes no `.env` — the server reads PUBLIC_URL
              * before it boots, and a value a browser could change would be a
              * value anyone with an admin session could change. So the last
              * step tells the truth about what the server will actually put in
              * Stripe redirects and emailed links, and leaves the setting to
              * the environment.
              */}
            {publicUrl && isLocalOrigin(publicUrl) ? (
              <Alert
                className={cx(styles.alert)}
                type="info"
                showIcon
                icon={<InfoCircleOutlined />}
                title="This server's public URL is still localhost"
                description={
                  <p className={cx(styles.alertText)}>
                    <code>PUBLIC_URL</code> is <code>{publicUrl}</code>. Stripe sends buyers
                    back there after paying and every emailed link starts with it, so set it
                    in the environment before this store is public.
                  </p>
                }
              />
            ) : null}

            <div className={cx(styles.actions)}>
              <Button onClick={() => setStep(1)} disabled={submit.isPending}>
                Back
              </Button>
              <Button
                type="primary"
                onClick={finish}
                loading={submit.isPending}
                disabled={Boolean(lockStorefrontChoice) && storefrontPassword.length < 8}
              >
                Create my store
              </Button>
            </div>
          </>
        ) : null}
      </Card>
    </main>
  );
}

/* ------------------------------------------------------------------ step 1 */

function IdentityStep({
  initial,
  requiresToken,
  onDone,
}: {
  initial: IdentityValues | null;
  requiresToken: boolean;
  onDone: (values: IdentityValues) => void;
}) {
  return (
    <Form
      layout="vertical"
      requiredMark={false}
      initialValues={initial ?? { currency: "USD" }}
      onFinish={onDone}
    >
      {/*
        * Shown only when the server says so — a production deploy, where this
        * page is public before anyone owns the store. The token is in the
        * server's log and nowhere else, which is what makes it proof that the
        * person filling this in is the person who deployed it.
        */}
      {requiresToken ? (
        <Form.Item
          name="setupToken"
          label="Setup token"
          help="Printed in the server's log when it started. Whoever can read that log is the operator; this proves you are."
          rules={[{ required: true, message: "Paste the setup token from the server log." }]}
        >
          <Input autoFocus autoComplete="off" spellCheck={false} size="large" />
        </Form.Item>
      ) : null}

      <Form.Item
        name="storeName"
        label="Store name"
        rules={[{ required: true, message: "Your store needs a name." }]}
      >
        <Input autoFocus={!requiresToken} placeholder="Blue Whale Goods" size="large" />
      </Form.Item>

      <Form.Item
        name="currency"
        label="Currency"
        help="Prices are stored in this currency's smallest unit and cannot be converted later."
        rules={[{ required: true }]}
      >
        <Select
          showSearch
          options={CURRENCIES.map((code) => ({ label: code, value: code }))}
          className={cx(styles.currency)}
        />
      </Form.Item>

      <div className={cx(styles.divider)}>
        <span>Your administrator account</span>
      </div>

      <Form.Item
        name="email"
        label="Email"
        rules={[
          { required: true, message: "Enter an email address." },
          { type: "email", message: "That does not look like an email address." },
        ]}
      >
        <Input type="email" autoComplete="username" size="large" />
      </Form.Item>

      <Form.Item
        name="password"
        label="Password"
        help="At least 12 characters. Stored as an argon2id hash — it cannot be read back."
        rules={[
          { required: true, message: "Choose a password." },
          { min: 12, message: "Use at least 12 characters." },
        ]}
      >
        <Input.Password autoComplete="new-password" size="large" />
      </Form.Item>

      <Form.Item
        name="confirm"
        label="Confirm password"
        dependencies={["password"]}
        rules={[
          { required: true, message: "Type the password again." },
          ({ getFieldValue }) => ({
            validator: (_rule, value: string) =>
              !value || getFieldValue("password") === value
                ? Promise.resolve()
                : Promise.reject(new Error("The passwords do not match.")),
          }),
        ]}
      >
        <Input.Password autoComplete="new-password" size="large" />
      </Form.Item>

      <div className={cx(styles.actions)}>
        <Button type="primary" htmlType="submit">
          Continue
        </Button>
      </div>
    </Form>
  );
}

/* ------------------------------------------------------------------ step 2 */

function PaymentsStep({
  hasSecret,
  mode,
  value,
  onChange,
  onBack,
  onNext,
}: {
  hasSecret: boolean;
  mode: "test" | "live" | null;
  value: string;
  onChange: (next: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const looksSecret = value.trim().startsWith("sk_");

  return (
    <div>
      <p className={cx(styles.stepIntro)}>
        Beluga uses Stripe&apos;s hosted checkout, so card details never touch this server. You can
        skip this and add it later — the catalogue works without it, it just cannot take money.
      </p>

      {hasSecret ? (
        <Alert
          className={cx(styles.alert)}
          type="success"
          showIcon
          icon={<CheckCircleTwoTone twoToneColor="#52c41a" />}
          title={
            <>
              A Stripe secret key is configured on the server{" "}
              {mode ? <Tag color={mode === "live" ? "red" : "blue"}>{mode} mode</Tag> : null}
            </>
          }
          description={
            mode === "live"
              ? "This is a live key. Publishing a product creates real objects in your Stripe account, and checkouts will charge real cards."
              : "Test mode — no real money can move."
          }
        />
      ) : (
        <Alert
          className={cx(styles.alert)}
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          title="No Stripe secret key on the server yet"
          description={
            <>
              <p className={cx(styles.alertText)}>
                The secret key is never accepted through a browser form, because storing it would
                mean this server writing to its own configuration. Put it in <code>.env</code>{" "}
                instead and restart the API:
              </p>
              <pre className={cx(styles.code)}>STRIPE_SECRET_KEY=sk_test_…</pre>
              <p className={cx(styles.alertText)}>
                Or re-run <code>npm run setup</code>, which validates the key against Stripe before
                writing it. Find your keys in{" "}
                <a href="https://docs.stripe.com/keys" target="_blank" rel="noreferrer">
                  Stripe&apos;s API keys documentation
                </a>
                .
              </p>
            </>
          }
        />
      )}

      <Form layout="vertical" requiredMark={false}>
        {/*
          * One `help` that swaps text rather than a `help` plus an `extra`:
          * antd colours `help` by validateStatus, so leaving the neutral
          * guidance there turned *it* red while the real error rendered grey
          * underneath — the opposite of what the two lines mean.
          */}
        <Form.Item
          label="Publishable key"
          help={
            looksSecret
              ? "That is a secret key. It must not go here, or into any browser."
              : "Needed to take payments. Set it here, via npm run setup, or later in Settings → Stripe."
          }
          {...(looksSecret ? { validateStatus: "error" as const } : {})}
        >
          <Input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="pk_test_…"
            size="large"
          />
        </Form.Item>
      </Form>

      {/*
        * Tax is named here and settled elsewhere, on purpose.
        *
        * Nothing in this wizard can activate Stripe Tax or record a
        * registration — both happen in the Stripe dashboard — so offering a
        * switch would let someone finish setup believing they were covered.
        * Saying it exists, and where it lives, is the honest version.
        */}
      <Alert
        className={cx(styles.alert)}
        type="info"
        showIcon
        title="This store will not collect tax yet"
        description={
          <p className={cx(styles.alertText)}>
            Tax is calculated by{" "}
            <a href="https://docs.stripe.com/tax" target="_blank" rel="noreferrer">
              Stripe Tax
            </a>
            , which is a paid add-on you activate in the Stripe dashboard, along with a
            registration for each place you are obliged to collect. Once that is done, turn it
            on in Settings → Tax. Beluga calculates nothing itself and files nothing on your
            behalf.
          </p>
        }
      />

      <div className={cx(styles.actions)}>
        <Button onClick={onBack}>Back</Button>
        <Button type="primary" onClick={onNext} disabled={looksSecret}>
          Continue
        </Button>
      </div>
    </div>
  );
}
