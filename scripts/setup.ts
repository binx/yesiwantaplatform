#!/usr/bin/env tsx
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { adminEmailSchema } from "../shared/api.js";
import { isLocalOrigin } from "../src/lib/publicUrl.js";

/**
 * `npm run setup` — the first-run path.
 *
 * v1's was: clone, `npm run server`, watch it throw an uncaught ENOENT on a
 * missing `config.env`, guess at that file's contents from the source, restart,
 * then meet a two-field modal. Worse, the server *wrote back* to `config.env`
 * at runtime to persist the admin password hash, so the app's configuration
 * and its secrets were the same mutable file.
 *
 * This writes `.env` once, on purpose, and never again. Secrets that belong in
 * the database (the admin password hash) go to the database.
 *
 * Nothing here is destructive: an existing value in `.env` is shown as the
 * default and kept unless it is explicitly replaced.
 */

const ENV_PATH = path.resolve(".env");
const EXAMPLE_PATH = path.resolve(".env.example");

/* ------------------------------------------------------------------ prompts */

const rl = readline.createInterface({ input: stdin, output: stdout });

async function ask(question: string, fallback = ""): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || fallback;
}

/**
 * Read a line without echoing it.
 *
 * The usual trick is to override readline's private `_writeToOutput`, and on
 * Node 22 it does not work for `readline/promises` — the keystrokes are echoed
 * anyway, so a prompt promising hidden input printed the password in clear
 * text. Reading the raw keystrokes ourselves is the only way to actually
 * guarantee it, so that is what this does: pause readline, take the terminal
 * raw, echo nothing, and hand everything back afterwards.
 */
function askSecret(question: string): Promise<string> {
  stdout.write(`${question}: `);

  if (!stdin.isTTY) return Promise.reject(new Error("A terminal is required to read a password."));

  return new Promise<string>((resolve, reject) => {
    const wasRaw = stdin.isRaw;
    let value = "";

    /*
     * readline's keypress echo has to be unhooked, not just paused.
     * `rl.pause()` only pauses the stream, and this function has to resume it
     * to read anything — at which point readline's own listener wakes up and
     * echoes every keystroke again. Detaching stdin's data listeners for the
     * duration is what actually silences it.
     */
    const listeners = stdin.listeners("data") as ((...args: unknown[]) => void)[];
    for (const listener of listeners) stdin.off("data", listener);

    const done = (settle: () => void) => {
      stdin.removeListener("data", onData);
      for (const listener of listeners) stdin.on("data", listener);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write("\n");
      rl.resume();
      settle();
    };

    const onData = (chunk: Buffer | string) => {
      for (const char of chunk.toString("utf8")) {
        switch (char) {
          case "\r":
          case "\n":
            return done(() => resolve(value));

          // Ctrl+C and Ctrl+D: cancel, the same as anywhere else in here.
          case "\u0003":
          case "\u0004":
            return done(() => {
              rl.close();
              reject(new Error("Cancelled."));
            });

          // Backspace and delete.
          case "\u0008":
          case "\u007f":
            value = value.slice(0, -1);
            break;

          default:
            // Skip the remaining control characters; take everything else.
            if (char >= " ") value += char;
        }
      }
    };

    rl.pause();
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function confirm(question: string, fallback = true): Promise<boolean> {
  const answer = (await rl.question(`${question} ${fallback ? "[Y/n]" : "[y/N]"}: `))
    .trim()
    .toLowerCase();
  if (answer === "") return fallback;
  return answer.startsWith("y");
}

const bold = (text: string) => `\u001b[1m${text}\u001b[0m`;
const dim = (text: string) => `\u001b[2m${text}\u001b[0m`;
const green = (text: string) => `\u001b[32m${text}\u001b[0m`;
const yellow = (text: string) => `\u001b[33m${text}\u001b[0m`;
const red = (text: string) => `\u001b[31m${text}\u001b[0m`;

function heading(text: string): void {
  console.log(`\n${bold(text)}\n${dim("─".repeat(Math.max(text.length, 24)))}`);
}

/* ----------------------------------------------------------------- env file */

/**
 * Rewrite one key in an `.env` file, in place.
 *
 * Operates on the file's own lines rather than a parsed object so comments,
 * ordering and the documentation in `.env.example` all survive. A key that is
 * present but commented out is uncommented rather than duplicated.
 */
function setEnvValue(lines: string[], key: string, value: string): string[] {
  const quoted = /[\s"'#$]/.test(value) ? `"${value.replace(/(["\\])/g, "\\$1")}"` : value;
  const pattern = new RegExp(`^\\s*#?\\s*${key}\\s*=`);

  const index = lines.findIndex((line) => pattern.test(line));
  if (index === -1) return [...lines, `${key}=${quoted}`];

  const next = [...lines];
  next[index] = `${key}=${quoted}`;
  return next;
}

function readEnvLines(): string[] {
  if (existsSync(ENV_PATH)) return readFileSync(ENV_PATH, "utf8").split("\n");
  // Start from the documented example so the written file keeps its comments.
  if (existsSync(EXAMPLE_PATH)) return readFileSync(EXAMPLE_PATH, "utf8").split("\n");
  return [];
}

function currentValue(lines: string[], key: string): string | null {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`);
  for (const line of lines) {
    const match = pattern.exec(line);
    if (!match) continue;
    const raw = (match[1] ?? "").trim();
    if (raw === "") return null;
    return raw.replace(/^["'](.*)["']$/, "$1");
  }
  return null;
}

/** 0600: this file holds a Stripe secret key and a session signing secret. */
function writeEnv(lines: string[]): void {
  const body = lines.join("\n").replace(/\n{3,}$/, "\n");
  writeFileSync(ENV_PATH, body.endsWith("\n") ? body : `${body}\n`, { mode: 0o600 });
}

/**
 * Validate a public origin the way `server/env.ts` will, and normalise it.
 *
 * A bare host is the usual mistake, and it fails on the protocol rather than
 * on parsing: `shop.example.com:8080` is a perfectly well-formed URL whose
 * scheme happens to be `shop.example.com`. The trailing slash is stripped
 * because every caller appends a path — a kept one produces
 * `https://shop.example.com//confirm` in the link Stripe redirects to.
 */
function parseOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  return value.trim().replace(/\/+$/, "");
}

/* ------------------------------------------------------------------- Stripe */

interface StripeCheck {
  ok: boolean;
  livemode?: boolean;
  message?: string;
}

/**
 * Validate a secret key against Stripe before it is written anywhere.
 *
 * A typo here is otherwise only discovered at the first checkout attempt, by a
 * customer. `balance.retrieve` is the cheapest authenticated call there is.
 */
async function checkStripeKey(key: string): Promise<StripeCheck> {
  try {
    const { default: Stripe } = await import("stripe");
    const { STRIPE_API_VERSION } = await import("../server/stripe.js");

    const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 1 });
    const balance = await stripe.balance.retrieve();

    return { ok: true, livemode: balance.livemode };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/* --------------------------------------------------------------------- main */

async function main(): Promise<void> {
  console.log(`\n${bold("🎷🐋  Beluga setup")}`);
  console.log(dim("Nothing is written until the end, and existing values are kept.\n"));

  if (!stdin.isTTY) {
    console.error(
      red("This command is interactive and needs a terminal.\n\n") +
        "For scripted or container setups, set the environment directly and seed:\n\n" +
        "  SESSION_SECRET=$(openssl rand -base64 32) \\\n" +
        "  ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a long passphrase' \\\n" +
        "  npm run db:seed\n",
    );
    process.exitCode = 1;
    return;
  }

  let lines = readEnvLines();
  const existed = existsSync(ENV_PATH);

  /* --- 1. session secret ------------------------------------------------- */

  heading("1. Session secret");

  if (currentValue(lines, "SESSION_SECRET")) {
    console.log(`${green("✓")} Already set — keeping it. Replacing it signs everyone out.`);
  } else {
    lines = setEnvValue(lines, "SESSION_SECRET", randomBytes(32).toString("base64"));
    console.log(`${green("✓")} Generated a 256-bit secret.`);
  }

  /* --- 2. database ------------------------------------------------------- */

  heading("2. Database");
  console.log(dim("SQLite is a file and needs nothing installed. Postgres works too.\n"));

  const databaseUrl = await ask(
    "Database URL",
    currentValue(lines, "DATABASE_URL") ?? "file:./data/beluga.sqlite",
  );
  lines = setEnvValue(lines, "DATABASE_URL", databaseUrl);

  if (databaseUrl.startsWith("file:")) {
    await mkdir(path.dirname(path.resolve(databaseUrl.slice("file:".length))), { recursive: true });
  }

  /* --- 3. Stripe --------------------------------------------------------- */

  heading("3. Stripe");
  console.log(
    dim(
      "Optional — the store runs and the catalogue works without it, but it\n" +
        "cannot take payment. Keys are at https://dashboard.stripe.com/apikeys\n",
    ),
  );

  let publishableKey = currentValue(lines, "STRIPE_PUBLISHABLE_KEY");

  if (currentValue(lines, "STRIPE_SECRET_KEY")) {
    console.log(`${green("✓")} A secret key is already configured — keeping it.`);
  } else if (await confirm("Connect Stripe now?", true)) {
    for (;;) {
      const secretKey = await askSecret("Secret key (sk_…, input hidden)");

      if (secretKey === "") {
        console.log(yellow("  Skipped. Set STRIPE_SECRET_KEY in .env when you're ready."));
        break;
      }

      if (!secretKey.startsWith("sk_")) {
        console.log(red("  That is not a secret key — it should start with sk_."));
        continue;
      }

      process.stdout.write("  Checking with Stripe… ");
      const check = await checkStripeKey(secretKey);

      if (!check.ok) {
        console.log(red("rejected."));
        console.log(dim(`  ${check.message ?? "Unknown error."}`));
        if (!(await confirm("  Try again?", true))) break;
        continue;
      }

      console.log(green("valid."));
      if (check.livemode) {
        console.log(
          yellow(
            "  ⚠  This is a LIVE key. Publishing a product will create real\n" +
              "     objects in your Stripe account and checkouts will charge cards.",
          ),
        );
        if (!(await confirm("  Use the live key anyway?", false))) continue;
      } else {
        console.log(dim("  Test mode — no real money can move."));
      }

      lines = setEnvValue(lines, "STRIPE_SECRET_KEY", secretKey);

      publishableKey = await ask("Publishable key (pk_…)", publishableKey ?? "");
      if (publishableKey.startsWith("sk_")) {
        console.log(red("  That is the secret key. Leaving the publishable key unset."));
        publishableKey = null;
      } else if (publishableKey) {
        lines = setEnvValue(lines, "STRIPE_PUBLISHABLE_KEY", publishableKey);
      }

      console.log(
        dim(
          "\n  Webhooks are how an order is confirmed. In development:\n" +
            "    stripe listen --forward-to localhost:4000/api/webhooks/stripe\n" +
            "  then put the whsec_… it prints into .env as STRIPE_WEBHOOK_SECRET.",
        ),
      );
      break;
    }
  }

  /* --- 4. public address --------------------------------------------------- */

  heading("4. Public address");
  console.log(
    dim(
      "Where shoppers will reach the store. Stripe sends buyers back here after\n" +
        "paying, and every emailed link starts with it. Leave the default while\n" +
        "developing; set it before the store is public.\n",
    ),
  );

  let publicUrl = currentValue(lines, "PUBLIC_URL") ?? "http://localhost:5173";
  for (;;) {
    const answer = parseOrigin(await ask("Public URL", publicUrl));

    if (!answer) {
      console.log(
        red(
          "  That is not a public address. It needs a scheme and a host,\n" +
            "  like https://shop.example.com.",
        ),
      );
      continue;
    }

    publicUrl = answer;
    break;
  }
  lines = setEnvValue(lines, "PUBLIC_URL", publicUrl);

  /* --- 5. storefront visibility -------------------------------------------- */

  heading("5. Storefront visibility");
  console.log(
    dim(
      "Deploying is not the same as being ready to show customers. A fresh\n" +
        "public address is port-scanned within minutes, so this defaults to\n" +
        "locked once the address above is not localhost.\n",
    ),
  );

  let storefrontPassword: string | null = null;

  if (
    await confirm(
      "Put a password on the storefront until you're ready to launch?",
      !isLocalOrigin(publicUrl),
    )
  ) {
    for (;;) {
      const value = await askSecret("Storefront password (8+ characters, input hidden)");
      if (value.length >= 8) {
        storefrontPassword = value;
        break;
      }
      console.log(red("  Too short — use at least 8 characters."));
    }
  }

  /* --- write .env before anything reads it -------------------------------- */

  writeEnv(lines);
  console.log(`\n${green("✓")} ${existed ? "Updated" : "Created"} .env`);

  // `server/env.ts` parses the environment the first time it is imported, so
  // every module below must be loaded *after* the file above is written.
  process.env.DATABASE_URL = databaseUrl;
  const secret = currentValue(lines, "SESSION_SECRET");
  if (secret) process.env.SESSION_SECRET = secret;
  const stripeSecret = currentValue(lines, "STRIPE_SECRET_KEY");
  if (stripeSecret) process.env.STRIPE_SECRET_KEY = stripeSecret;

  /* --- 6. migrations ------------------------------------------------------ */

  heading("6. Database schema");

  const { runMigrations } = await import("../db/migrate.js");
  await runMigrations();
  console.log(`${green("✓")} Migrations applied.`);

  if (storefrontPassword) {
    const { setStorefrontAccess, setStorefrontPassword: writeStorefrontPassword } = await import(
      "../db/admin-repository.js"
    );
    const { hashPassword } = await import("../server/auth.js");

    await writeStorefrontPassword(await hashPassword(storefrontPassword));
    await setStorefrontAccess("password");
    console.log(`${green("✓")} The storefront requires a password.`);
  }

  /* --- 7. admin account --------------------------------------------------- */

  heading("7. Administrator");

  const { countAdmins, createAdmin } = await import("../server/auth.js");

  if ((await countAdmins()) > 0) {
    console.log(`${green("✓")} An admin account already exists — leaving it alone.`);
  } else {
    /*
     * The same schema the browser wizard validates against, so the two paths
     * refuse the same strings. Unvalidated, a typo here becomes an account
     * nobody can sign into and nothing will ever email — and the only way out
     * is editing the database by hand.
     */
    let email = "";
    for (;;) {
      const answer = adminEmailSchema.safeParse(await ask("Email", ""));
      if (answer.success) {
        email = answer.data;
        break;
      }
      console.log(red("  That is not an email address. You sign in with it, and it receives"));
      console.log(red("  password resets and staff invitations."));
    }

    let password = "";
    for (;;) {
      password = await askSecret("Password (12+ characters, input hidden)");

      if (password.length < 12) {
        console.log(red("  Too short — use at least 12 characters."));
        continue;
      }

      const again = await askSecret("Confirm password");
      if (again !== password) {
        console.log(red("  They don't match."));
        continue;
      }
      break;
    }

    await createAdmin(email, password);
    console.log(`${green("✓")} Created ${email}. The hash is argon2id, stored in the database.`);
  }

  /* --- 8. store + demo data ----------------------------------------------- */

  heading("8. Your store");

  const { getSettings } = await import("../db/repository.js");
  const settings = await getSettings();

  if (settings) {
    console.log(`${green("✓")} "${settings.name}" already exists — leaving it alone.`);
  } else {
    const name = await ask("Store name", "My Store");
    const currency = (await ask("Currency (ISO 4217)", "USD")).toUpperCase();

    const seed = await confirm("Load the demo catalogue so there's something to look at?", true);

    if (seed) {
      const { seedIfEmpty } = await import("../db/seed.js");
      await seedIfEmpty();
    }

    const { defaultTheme, defaultHero, DEFAULT_TAX_CODE } = await import("../shared/schema.js");
    const { updateSettings } = await import("../db/admin-repository.js");

    await updateSettings({
      name,
      currency,
      // As in the browser wizard: the terminal path does not ask, and Settings
      // → Identity is where a store that is not `en-US` says so.
      locale: "en-US",
      stripePublishableKey: publishableKey?.startsWith("pk_") ? publishableKey : null,
      aboutText: null,
      // Tax stays off until the merchant has activated Stripe Tax and
      // registered their obligations. Nothing here can do that for them, and a
      // store that silently starts collecting would be worse than one that
      // does not — see the Settings copy.
      taxEnabled: false,
      taxBehavior: "exclusive",
      defaultTaxCode: DEFAULT_TAX_CODE,
      // Off until the merchant opts in from Settings — see the Settings copy.
      cartRecoveryEnabled: false,
      cartRecoveryDelayHours: 4,
      hero: defaultHero,
      theme: defaultTheme,
    });

    console.log(`${green("✓")} ${seed ? "Seeded the demo catalogue and set" : "Created"} "${name}".`);
  }

  /* --- done --------------------------------------------------------------- */

  heading("Ready");
  console.log(`  Start it with:  ${bold("npm run dev:all")}`);
  // PUBLIC_URL, not a literal: it is what Stripe and every emailed link will
  // use, so printing anything else here would be printing a second answer.
  console.log(`  Storefront:     ${publicUrl}`);
  console.log(`  Admin:          ${publicUrl}/admin`);
  if (storefrontPassword) {
    console.log(
      dim("  The storefront is locked. Change or remove the password under Settings → Visibility."),
    );
  }
  console.log();
}

/**
 * Ctrl+C and Ctrl+D are answers too.
 *
 * Both close the readline interface, which rejects the pending question. That
 * is a person changing their mind, not a failure, and it must not look like a
 * crash — nothing is written before the `.env` step anyway, and anything
 * already written stays valid.
 */
let cancelled = false;
rl.on("close", () => {
  cancelled = true;
});

main()
  .then(() => rl.close())
  .catch((error: unknown) => {
    rl.close();

    if (cancelled) {
      console.log(`\n${yellow("Cancelled.")} Run ${bold("npm run setup")} again whenever you like.`);
      process.exit(130);
    }

    console.error(
      `\n${red("Setup failed:")} ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
