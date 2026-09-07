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

  /** Max upload size in bytes. */
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),
});

export type Env = z.infer<typeof schema> & { SESSION_SECRET: string };

function load(): Env {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`);
  }

  const env = parsed.data;

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
