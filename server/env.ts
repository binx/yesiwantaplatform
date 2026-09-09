import { z } from "zod";
import dotenv from "dotenv";

// ENV_FILE lets tests and deployments point somewhere other than .env.
dotenv.config({ path: process.env.ENV_FILE ?? ".env", quiet: true });

/**
 * Environment, parsed once and validated.
 *
 * v1 did `if (dotenv.error) throw dotenv.error`, so a clean clone crashed on
 * `npm run server` with a raw ENOENT and no hint about what to create. Here a
 * missing configuration is a *state* the server reports, not a crash: see
 * `isConfigured` below and the setup route in Phase 5.
 */

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /**
   * Distinct from Vite's PORT so `npm run dev:all` cannot collide.
   * Not 5000: macOS ControlCenter (AirPlay Receiver) binds that port, which
   * makes the API silently unreachable on a Mac.
   */
  API_PORT: z.coerce.number().int().positive().default(4000),

  /**
   * Interface to bind. `0.0.0.0` for a container or a PaaS, where the platform's
   * edge is the only thing that can reach the port. On a VM with a reverse
   * proxy on the same box set `127.0.0.1`: otherwise the Node port is reachable
   * from the internet as well, and a request that skips the proxy arrives over
   * plain HTTP carrying whatever `X-Forwarded-*` headers the sender chose.
   */
  API_HOST: z.string().min(1).default("0.0.0.0"),

  /**
   * Express's `trust proxy` setting, as a string: `false`, `true`, a hop count
   * (`1`), or a comma-separated list of addresses or subnets (`loopback`,
   * `10.0.0.0/8`). It decides which `X-Forwarded-For` entry is the client's
   * address and whether `X-Forwarded-Proto: https` counts as a secure request.
   * Both the login rate limit and the `Secure` session cookie depend on it, so
   * trusting more hops than actually exist lets a caller pick their own IP.
   * Defaults to one hop in production, none otherwise.
   */
  TRUST_PROXY: z.string().optional(),

  /**
   * A shared secret the first-run wizard must present before it may create the
   * first administrator. In production one is generated and printed at boot
   * when the store is unconfigured; set this to choose the value yourself.
   * See `activeSetupToken` in server/routes/setup.ts.
   */
  SETUP_TOKEN: z.string().min(16, "SETUP_TOKEN must be at least 16 characters.").optional(),

  /** file:./data/beluga.sqlite for SQLite, postgres://… for Postgres. */
  DATABASE_URL: z.string().default("file:./data/beluga.sqlite"),

  /** Signs session cookies. Required in production; generated in dev if absent. */
  SESSION_SECRET: z.string().min(32).optional(),

  /** Server-only. Must never be sent to a client. */
  STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),

  /** Origin used for Stripe redirect URLs and CORS. */
  PUBLIC_URL: z.string().url().default("http://localhost:5173"),

  /**
   * Any SMTP provider, e.g. smtps://user:pass@smtp.example.com:465
   * v1 hard-coded a Gmail OAuth2 transport and six EMAIL_* variables.
   */
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  /**
   * Where uploaded imagery is written and served from.
   *
   * Relative paths resolve against the working directory, like `dist` and the
   * migrations folder. The default keeps a clone working with no setup; a
   * deployment points this at a mounted volume so images survive a redeploy —
   * the constraint that rules platforms in and out, see docs/site-plan.md §7.3.
   * Only the directory is configurable, never the URL: `/assets/<path>` stays
   * the contract with the database and the storefront.
   */
  ASSETS_DIR: z.string().min(1).default("public/assets"),

  /**
   * Max upload size in bytes. 20 MB: room for a camera-original product photo,
   * which is re-encoded and capped at 2400px on the way in regardless. This is
   * a ceiling for imagery only; digital product files are not uploaded here.
   */
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),

  /**
   * Let outbound webhooks reach plain HTTP and private addresses.
   *
   * Off by default, and it should stay off on anything public: without it an
   * endpoint URL is checked against the address its hostname *resolves to*, so
   * a merchant cannot point Beluga at 169.254.169.254 and read the host's cloud
   * metadata back out of the delivery log. The opt-out exists for a self-hoster
   * whose fulfilment script genuinely listens on localhost.
   */
  WEBHOOK_ALLOW_INSECURE_TARGETS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type Env = Omit<z.infer<typeof schema>, "SESSION_SECRET" | "TRUST_PROXY"> & {
  SESSION_SECRET: string;
  TRUST_PROXY: boolean | number | string;
};

/**
 * Parse `TRUST_PROXY` into what Express accepts.
 *
 * `true` is deliberately allowed but never the default: it trusts every hop,
 * which means the leftmost `X-Forwarded-For` value — the one the client wrote.
 */
function parseTrustProxy(value: string | undefined, production: boolean): boolean | number | string {
  if (value === undefined || value === "") return production ? 1 : false;

  const lowered = value.trim().toLowerCase();
  if (lowered === "false" || lowered === "0" || lowered === "no") return false;
  if (lowered === "true" || lowered === "yes") return true;
  if (/^\d+$/.test(lowered)) return Number(lowered);

  return value.trim();
}

function load(): Env {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`);
  }

  const env = {
    ...parsed.data,
    TRUST_PROXY: parseTrustProxy(parsed.data.TRUST_PROXY, parsed.data.NODE_ENV === "production"),
  };

  if (!env.SESSION_SECRET) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "SESSION_SECRET is required in production. Generate one with: openssl rand -base64 32",
      );
    }
    // Ephemeral in dev: sessions do not survive a restart, which is fine and
    // strictly better than shipping a hard-coded default secret.
    return { ...env, SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID() };
  }

  return { ...env, SESSION_SECRET: env.SESSION_SECRET };
}

export const env = load();

export const isProduction = env.NODE_ENV === "production";
export const isSqlite = env.DATABASE_URL.startsWith("file:");

/** Stripe features stay disabled until a secret key is present. */
export const hasStripe = Boolean(env.STRIPE_SECRET_KEY);
