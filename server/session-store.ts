import { Store, type SessionData } from "express-session";
import { eq, lt } from "drizzle-orm";
import { getDatabase } from "../db/client.js";

/**
 * Sessions in the database.
 *
 * express-session's default MemoryStore leaks and does not survive a restart
 * or span more than one process; v1 shipped with it. This works on either
 * dialect and expires rows rather than trusting the cookie alone.
 */

type Callback = (err?: unknown, session?: SessionData | null) => void;

const PRUNE_INTERVAL_MS = 15 * 60 * 1000;

/** Postgres wants a Date for timestamptz; SQLite stores a unix integer. */
function encodeExpiry(dialect: string, expiresAt: Date): Date | number {
  return dialect === "pg" ? expiresAt : Math.floor(expiresAt.getTime() / 1000);
}

function decodeExpiry(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value * 1000;
  return 0;
}

export class DrizzleSessionStore extends Store {
  private timer: NodeJS.Timeout | undefined;

  constructor() {
    super();
    this.timer = setInterval(() => void this.prune(), PRUNE_INTERVAL_MS);
    // Never hold the process open for session cleanup.
    this.timer.unref();
  }

  override get(sid: string, callback: Callback): void {
    void (async () => {
      try {
        const { drizzle: db, schema } = await getDatabase();
        const rows = (await db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.sid, sid))
          .limit(1)) as unknown as { data: string; expiresAt: unknown }[];

        const row = rows[0];
        if (!row) return callback(null, null);

        // Expired rows are treated as absent even if cleanup has not run.
        if (decodeExpiry(row.expiresAt) < Date.now()) {
          await this.destroyAsync(sid);
          return callback(null, null);
        }

        callback(null, JSON.parse(row.data) as SessionData);
      } catch (error) {
        callback(error);
      }
    })();
  }

  override set(sid: string, session: SessionData, callback?: (err?: unknown) => void): void {
    void (async () => {
      try {
        const { drizzle: db, schema, dialect } = await getDatabase();

        const expiresAt = session.cookie.expires
          ? new Date(session.cookie.expires)
          : new Date(Date.now() + 24 * 60 * 60 * 1000);

        const values = {
          sid,
          data: JSON.stringify(session),
          expiresAt: encodeExpiry(dialect, expiresAt),
        };

        await db
          .insert(schema.sessions)
          .values(values)
          .onConflictDoUpdate({
            target: schema.sessions.sid,
            set: { data: values.data, expiresAt: values.expiresAt },
          });

        callback?.();
      } catch (error) {
        callback?.(error);
      }
    })();
  }

  override destroy(sid: string, callback?: (err?: unknown) => void): void {
    void this.destroyAsync(sid)
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  override touch(sid: string, session: SessionData, callback?: (err?: unknown) => void): void {
    // Refreshing the expiry is exactly what `set` already does.
    this.set(sid, session, callback);
  }

  private async destroyAsync(sid: string): Promise<void> {
    const { drizzle: db, schema } = await getDatabase();
    await db.delete(schema.sessions).where(eq(schema.sessions.sid, sid));
  }

  private async prune(): Promise<void> {
    try {
      const { drizzle: db, schema, dialect } = await getDatabase();
      await db
        .delete(schema.sessions)
        .where(lt(schema.sessions.expiresAt, encodeExpiry(dialect, new Date())));
    } catch {
      // Cleanup is best-effort; a failure here must not take the server down.
    }
  }

  /** Stop the prune timer — used by tests. */
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
