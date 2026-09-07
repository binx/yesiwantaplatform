import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Server tests get their own throwaway SQLite file.
 *
 * `server/env.ts` reads process.env when it is first imported, so these must
 * be set before any module under test is loaded — hence a setup file rather
 * than assignment inside a test.
 */
const directory = mkdtempSync(path.join(tmpdir(), "beluga-test-"));

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = `file:${path.join(directory, "test.sqlite")}`;
process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough-to-pass";
process.env.PUBLIC_URL = "http://localhost:5173";
