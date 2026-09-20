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

  /** file:./data/platform.sqlite for SQLite, postgres://… for Postgres. */
  DATABASE_URL: z.string().default("file:./data/platform.sqlite"),

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
   * Object storage for uploaded imagery, instead of ASSETS_DIR.
   *
   * Setting ASSETS_S3_BUCKET selects the bucket driver (server/image-store.ts)
   * and makes the rest of the group required — checked in `objectStorageFrom`
   * below, at boot, rather than as a 500 on the first upload. Any S3-compatible
   * provider works, which is why there is one group and not one per vendor.
   * ASSETS_PUBLIC_URL is where browsers are sent: the bucket's public address
   * or a CDN in front of it. Stored paths stay relative, so switching drivers
   * is configuration, not a data migration.
   */
  ASSETS_S3_BUCKET: z.string().optional(),
  ASSETS_S3_ENDPOINT: z.string().optional(),
  ASSETS_S3_REGION: z.string().optional(),
  ASSETS_S3_ACCESS_KEY_ID: z.string().optional(),
  ASSETS_S3_SECRET_ACCESS_KEY: z.string().optional(),
  ASSETS_S3_ACL: z.string().optional(),
  ASSETS_PUBLIC_URL: z.string().optional(),

  /**
   * Max upload size in bytes. 20 MB: room for a camera-original product photo,
   * which is re-encoded and capped at 2400px on the way in regardless. This is
   * a ceiling for imagery only; digital product files are not uploaded here.
   */
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),

  /**
   * Lob, which prints and mails the postcards.
   *
   * A `test_` key talks to Lob's sandbox, where nothing is printed and every
   * address is accepted; a `live_` key costs money per card. Absent, the
   * fulfilment sweep leaves every card `scheduled` and the admin says so —
   * a store can take orders before its printer is wired up, exactly as it
   * can before its email is.
   */
  LOB_API_KEY: z
    .string()
    .regex(/^(test|live)_[A-Za-z0-9]+$/, "LOB_API_KEY should start with test_ or live_.")
    .optional(),
  /**
   * A Lob HTML template (`tmpl_…`) for the back of the card. v1 kept its back
   * design in Lob's template editor and sent the message as merge variables;
   * set this to keep doing that. Unset, the back is rendered from
   * `print/back.hbs` in this repo and sent as HTML, which needs nothing in
   * the Lob dashboard at all.
   */
  LOB_BACK_TEMPLATE_ID: z.string().regex(/^tmpl_[A-Za-z0-9]+$/).optional(),
  /**
   * Lob requires every mailpiece to declare what kind of mail it is. A
   * postcard someone writes to a friend is not marketing, so the default is
   * operational; a store using Lob differently can say so here.
   */
  LOB_USE_TYPE: z.enum(["operational", "marketing"]).default("operational"),
  /**
   * The signing secret of the Lob webhook pointed at /api/webhooks/lob, from
   * the webhook's page in the Lob dashboard. Absent, tracking events are
   * refused with 503 and the admin overview says so; nothing else changes.
   */
  LOB_WEBHOOK_SECRET: z.string().min(1).optional(),
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

/** The bucket driver's settings, present only when the whole group is. */
export interface ObjectStorage {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string | undefined;
  publicUrl: string;
  acl: string | undefined;
}

const S3_REQUIRED = [
  "ASSETS_S3_REGION",
  "ASSETS_S3_ACCESS_KEY_ID",
  "ASSETS_S3_SECRET_ACCESS_KEY",
  "ASSETS_PUBLIC_URL",
] as const;
const S3_OPTIONAL = ["ASSETS_S3_ENDPOINT", "ASSETS_S3_ACL"] as const;

/**
 * Validate the bucket settings as a group.
 *
 * Half a configuration is the failure worth catching: a bucket with no key
 * would be a 500 on the first upload, and a key with no bucket would quietly
 * write to disk on a platform that loses it at the next deploy. Both are
 * refused at boot with the variable names, next to the rest of this file's
 * errors. A blank value counts as unset, since that is what a commented-out
 * `.env` line becomes once someone uncomments it to fill in later.
 */
function objectStorageFrom(values: Env): ObjectStorage | null {
  const set = (name: (typeof S3_REQUIRED | typeof S3_OPTIONAL)[number] | "ASSETS_S3_BUCKET") =>
    Boolean(values[name]);

  if (!values.ASSETS_S3_BUCKET) {
    const stray = [...S3_REQUIRED, ...S3_OPTIONAL].filter(set);
    if (stray.length > 0) {
      throw new Error(
        `${stray.join(", ")} ${stray.length === 1 ? "is" : "are"} set but ASSETS_S3_BUCKET is not, ` +
          "so uploads would go to disk. Set ASSETS_S3_BUCKET to use the bucket, or unset the rest. " +
          "See .env.example.",
      );
    }
    return null;
  }

  const missing = S3_REQUIRED.filter((name) => !set(name));
  if (missing.length > 0) {
    throw new Error(
      `ASSETS_S3_BUCKET is set, so uploads go to a bucket, but ${missing.join(", ")} ` +
        `${missing.length === 1 ? "is" : "are"} not. Set ${missing.length === 1 ? "it" : "them"}, ` +
        "or unset ASSETS_S3_BUCKET to keep images on disk. See .env.example.",
    );
  }

  const url = (name: "ASSETS_PUBLIC_URL" | "ASSETS_S3_ENDPOINT", value: string): string => {
    try {
      new URL(value);
      return value;
    } catch {
      throw new Error(`${name} must be an absolute URL, got "${value}". See .env.example.`);
    }
  };

  return {
    bucket: values.ASSETS_S3_BUCKET,
    region: values.ASSETS_S3_REGION!,
    accessKeyId: values.ASSETS_S3_ACCESS_KEY_ID!,
    secretAccessKey: values.ASSETS_S3_SECRET_ACCESS_KEY!,
    endpoint: values.ASSETS_S3_ENDPOINT ? url("ASSETS_S3_ENDPOINT", values.ASSETS_S3_ENDPOINT) : undefined,
    publicUrl: url("ASSETS_PUBLIC_URL", values.ASSETS_PUBLIC_URL!),
    acl: values.ASSETS_S3_ACL || undefined,
  };
}

export const objectStorage = objectStorageFrom(env);

export const isProduction = env.NODE_ENV === "production";
export const isSqlite = env.DATABASE_URL.startsWith("file:");

/** Stripe features stay disabled until a secret key is present. */
export const hasStripe = Boolean(env.STRIPE_SECRET_KEY);

/** Nothing goes to print until a Lob key is present. */
export const hasLob = Boolean(env.LOB_API_KEY);
/** Delivery tracking arrives only through a signed webhook. */
export const hasLobWebhook = Boolean(env.LOB_WEBHOOK_SECRET);
export const lobMode: "test" | "live" | null = env.LOB_API_KEY
  ? env.LOB_API_KEY.startsWith("live_")
    ? "live"
    : "test"
  : null;
