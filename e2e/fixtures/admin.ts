/**
 * The e2e suite's own owner account.
 *
 * Created once by `global-setup.ts` against the suite's dedicated database
 * (never the developer's local `data/beluga.sqlite`), so admin specs sign in
 * as a fixture with a known password instead of needing a real operator to
 * type one into a form.
 */
export const ADMIN_EMAIL = "e2e-owner@example.com";
export const ADMIN_PASSWORD = "e2e-fixture-password-not-real";

/** Cookie jar captured after signing this account in; see `global-setup.ts`. */
export const ADMIN_STORAGE_STATE = "e2e/.auth/admin.json";
