import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Server tests get their own throwaway SQLite file — and their own empty
 * `.env`.
 *
 * `server/env.ts` reads process.env when it is first imported, so these must
 * be set before any module under test is loaded — hence a setup file rather
 * than assignment inside a test.
 */
const directory = mkdtempSync(path.join(tmpdir(), "postcards-test-"));

/*
 * The tests read no `.env` but their own, which is empty.
 *
 * `server/env.ts` calls `dotenv.config()`, and dotenv fills in any key that
 * is *not already* in process.env — so a developer with a real LOB_API_KEY
 * in `.env` was handing it to every server test, and the three suites that
 * assert on an unconfigured Lob failed on their machine while passing in CI.
 * Deleting the key here would not help: dotenv would put it straight back,
 * precisely because it was then absent. Pointing ENV_FILE somewhere empty is
 * what makes the environment below the whole truth, for this key and for
 * every other one a machine happens to have set.
 */
const envFile = path.join(directory, "empty.env");
writeFileSync(envFile, "");
process.env.ENV_FILE = envFile;

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = `file:${path.join(directory, "test.sqlite")}`;
process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough-to-pass";
process.env.PUBLIC_URL = "http://localhost:5173";

// Fake but well-formed Stripe credentials. No network call is ever made:
// tests stub the API calls and exercise the real signature verification,
// which is pure crypto.
process.env.STRIPE_SECRET_KEY = "sk_test_postcards_fake_key_for_tests";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_postcards_fake_webhook_secret";

/*
 * No printer, unless a test says so. Several suites assert on what an
 * unconfigured Lob does — the environment panel's `hasLob: false`, "Lob is
 * not configured" from the test-send route, an address accepted because
 * nothing could verify it — and a key exported in the shell would reach them
 * even with the empty `.env` above. The suites that do want Lob set these
 * themselves before importing the app.
 */
delete process.env.LOB_API_KEY;
delete process.env.LOB_WEBHOOK_SECRET;
