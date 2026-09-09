import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Staff accounts.
 *
 * The interesting assertions are the refusals: you cannot lock a store out of
 * itself by removing the last owner or your own account, a removed colleague
 * stops being signed in immediately rather than when their cookie expires, and
 * a spent or tampered invitation is not a way in.
 */

let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";

async function signIn(email = "owner@example.com", password = PASSWORD) {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);

  const login = await agent
    .post("/api/session")
    .set("x-csrf-token", bootstrap.body.csrfToken as string)
    .send({ email, password });

  return { agent, csrf: (login.body.csrfToken ?? bootstrap.body.csrfToken) as string, login };
}

/** Invite someone and return the raw token from the returned link. */
async function invite(
  agent: request.Agent,
  csrf: string,
  email: string,
): Promise<{ id: string; token: string }> {
  const response = await agent
    .post("/api/admin/users")
    .set("x-csrf-token", csrf)
    .send({ email, role: "staff" })
    .expect(201);

  // Without SMTP the link comes back so a self-hosted store is not stuck.
  const url = new URL(response.body.inviteUrl as string);
  return { id: response.body.id as string, token: url.searchParams.get("token")! };
}

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createAdmin } = await import("./auth.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  await createAdmin("owner@example.com", PASSWORD);

  app = createApp();
});

describe("listing administrators", () => {
  it("never includes a password hash", async () => {
    const { agent } = await signIn();
    const response = await agent.get("/api/admin/users").expect(200);

    // The failure this whole module exists to prevent: v1 served its hash to
    // the browser inside config.env.
    expect(JSON.stringify(response.body)).not.toContain("$argon2");
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
    expect((response.body as { users: { email: string }[] }).users[0]?.email).toBe(
      "owner@example.com",
    );
  });

  it("marks the requesting account as itself", async () => {
    const { agent } = await signIn();
    const response = await agent.get("/api/admin/users").expect(200);
    const body = response.body as { users: { email: string; isSelf: boolean; id: string }[] };

    const self = body.users.find((u) => u.isSelf)!;
    expect(self.email).toBe("owner@example.com");
  });
});

describe("removing an administrator", () => {
  it("refuses to remove the account making the request", async () => {
    const { agent, csrf } = await signIn();
    const list = await agent.get("/api/admin/users").expect(200);
    const listed = list.body as { users: { id: string; isSelf: boolean }[] };
    const me = listed.users.find((u) => u.isSelf)!;

    const response = await agent
      .delete(`/api/admin/users/${me.id}`)
      .set("x-csrf-token", csrf)
      .expect(409);

    expect(response.body.error).toMatch(/your own account/i);
  });

  it("refuses to remove the last owner", async () => {
    const { agent, csrf } = await signIn();

    // A second account, so "you cannot remove yourself" is not what fires.
    const { token } = await invite(agent, csrf, "second-owner@example.com");
    const invitee = request.agent(app);
    const bootstrap = await invitee.get("/api/session").expect(200);
    await invitee
      .post("/api/invites/accept")
      .set("x-csrf-token", bootstrap.body.csrfToken as string)
      .send({ token, password: PASSWORD })
      .expect(201);

    const asStaff = await signIn("second-owner@example.com", PASSWORD);
    const list = await asStaff.agent.get("/api/admin/users").expect(200);
    const listed = list.body as { users: { id: string; email: string }[] };
    const owner = listed.users.find((u) => u.email === "owner@example.com")!;

    const response = await asStaff.agent
      .delete(`/api/admin/users/${owner.id}`)
      .set("x-csrf-token", asStaff.csrf)
      .expect(409);

    expect(response.body.error).toMatch(/last owner/i);
  });

  it("signs a removed administrator out immediately", async () => {
    const { agent, csrf } = await signIn();
    const { token } = await invite(agent, csrf, "leaving@example.com");

    const leaver = request.agent(app);
    const bootstrap = await leaver.get("/api/session").expect(200);
    await leaver
      .post("/api/invites/accept")
      .set("x-csrf-token", bootstrap.body.csrfToken as string)
      .send({ token, password: PASSWORD })
      .expect(201);

    // Signed in and working.
    await leaver.get("/api/admin/users").expect(200);

    const list = await agent.get("/api/admin/users").expect(200);
    const listed = list.body as { users: { id: string; email: string }[] };
    const target = listed.users.find((u) => u.email === "leaving@example.com")!;

    await agent.delete(`/api/admin/users/${target.id}`).set("x-csrf-token", csrf).expect(204);

    // Not "until the cookie expires" — now.
    await leaver.get("/api/admin/users").expect(401);
  });

  it("404s for an account that does not exist", async () => {
    const { agent, csrf } = await signIn();
    await agent
      .delete("/api/admin/users/not-a-real-id")
      .set("x-csrf-token", csrf)
      .expect(404);
  });
});

describe("invitations", () => {
  it("lets an invitee set a password and sign in", async () => {
    const { agent, csrf } = await signIn();
    const { token } = await invite(agent, csrf, "newcomer@example.com");

    const invitee = request.agent(app);
    const bootstrap = await invitee.get("/api/session").expect(200);
    await invitee
      .post("/api/invites/accept")
      .set("x-csrf-token", bootstrap.body.csrfToken as string)
      .send({ token, password: "another-long-enough-password" })
      .expect(201);

    const fresh = await signIn("newcomer@example.com", "another-long-enough-password");
    expect(fresh.login.status).toBe(200);
  });

  it("rejects a tampered token", async () => {
    const { agent, csrf } = await signIn();
    const { token } = await invite(agent, csrf, "tampered@example.com");

    const outsider = request.agent(app);
    const bootstrap = await outsider.get("/api/session").expect(200);

    const response = await outsider
      .post("/api/invites/accept")
      .set("x-csrf-token", bootstrap.body.csrfToken as string)
      .send({ token: `${token.slice(0, -1)}X`, password: PASSWORD })
      .expect(410);

    expect(response.body.error).toMatch(/not valid/i);
  });

  it("refuses a second use of the same invitation", async () => {
    const { agent, csrf } = await signIn();
    const { token } = await invite(agent, csrf, "once-only@example.com");

    const first = request.agent(app);
    const bootstrapOne = await first.get("/api/session").expect(200);
    await first
      .post("/api/invites/accept")
      .set("x-csrf-token", bootstrapOne.body.csrfToken as string)
      .send({ token, password: PASSWORD })
      .expect(201);

    const second = request.agent(app);
    const bootstrapTwo = await second.get("/api/session").expect(200);
    const response = await second
      .post("/api/invites/accept")
      .set("x-csrf-token", bootstrapTwo.body.csrfToken as string)
      .send({ token, password: PASSWORD })
      .expect(410);

    expect(response.body.error).toMatch(/already been used/i);
  });

  it("refuses to invite an email that already has an account", async () => {
    const { agent, csrf } = await signIn();
    const { token } = await invite(agent, csrf, "duplicate@example.com");

    const first = request.agent(app);
    const bootstrap = await first.get("/api/session").expect(200);
    await first
      .post("/api/invites/accept")
      .set("x-csrf-token", bootstrap.body.csrfToken as string)
      .send({ token, password: PASSWORD })
      .expect(201);

    // Refused at the form, not at accept time.
    const response = await agent
      .post("/api/admin/users")
      .set("x-csrf-token", csrf)
      .send({ email: "duplicate@example.com", role: "staff" })
      .expect(409);

    expect(response.body.error).toMatch(/already has an account/i);
  });

  it("refuses an invitation whose address gained an account in the meantime", async () => {
    const { agent, csrf } = await signIn();
    // Two invites out at once, both valid; the second is stale by the time it
    // is used, and must fail without having been consumed for nothing.
    const { token: first } = await invite(agent, csrf, "raced@example.com");
    const { token: second } = await invite(agent, csrf, "raced@example.com");

    for (const [token, status] of [[first, 201], [second, 409]] as const) {
      const invitee = request.agent(app);
      const bootstrap = await invitee.get("/api/session").expect(200);
      await invitee
        .post("/api/invites/accept")
        .set("x-csrf-token", bootstrap.body.csrfToken as string)
        .send({ token, password: PASSWORD })
        .expect(status);
    }
  });

  it("rejects a password that is too short", async () => {
    const { agent, csrf } = await signIn();
    const { token } = await invite(agent, csrf, "shortpw@example.com");

    const invitee = request.agent(app);
    const bootstrap = await invitee.get("/api/session").expect(200);

    await invitee
      .post("/api/invites/accept")
      .set("x-csrf-token", bootstrap.body.csrfToken as string)
      .send({ token, password: "short" })
      .expect(400);
  });
});

describe("changing your own password", () => {
  it("requires the current password", async () => {
    const { agent, csrf } = await signIn();

    const response = await agent
      .put("/api/admin/users/me/password")
      .set("x-csrf-token", csrf)
      .send({ current: "not-the-password", next: "a-brand-new-long-password" })
      .expect(401);

    expect(response.body.error).toMatch(/current password/i);
  });

  it("changes it when the current one is right", async () => {
    const { agent, csrf } = await signIn();
    const { token } = await invite(agent, csrf, "changer@example.com");

    const invitee = request.agent(app);
    const bootstrap = await invitee.get("/api/session").expect(200);
    const accepted = await invitee
      .post("/api/invites/accept")
      .set("x-csrf-token", bootstrap.body.csrfToken as string)
      .send({ token, password: PASSWORD })
      .expect(201);

    await invitee
      .put("/api/admin/users/me/password")
      .set("x-csrf-token", accepted.body.csrfToken as string)
      .send({ current: PASSWORD, next: "a-brand-new-long-password" })
      .expect(204);

    const oldPassword = await signIn("changer@example.com", PASSWORD);
    expect(oldPassword.login.status).toBe(401);

    const newPassword = await signIn("changer@example.com", "a-brand-new-long-password");
    expect(newPassword.login.status).toBe(200);
  });

  it("signs out every other session, and keeps the one that made the change", async () => {
    const { agent, csrf } = await signIn();
    const { token } = await invite(agent, csrf, "two-devices@example.com");

    const laptop = request.agent(app);
    const bootstrap = await laptop.get("/api/session").expect(200);
    await laptop
      .post("/api/invites/accept")
      .set("x-csrf-token", bootstrap.body.csrfToken as string)
      .send({ token, password: PASSWORD })
      .expect(201);

    // A second, older session — the one on the phone that went missing.
    const phone = await signIn("two-devices@example.com", PASSWORD);
    expect(phone.login.status).toBe(200);
    await phone.agent.get("/api/admin/settings").expect(200);

    const changed = await laptop
      .put("/api/admin/users/me/password")
      .set("x-csrf-token", (await laptop.get("/api/session")).body.csrfToken as string)
      .send({ current: PASSWORD, next: "a-brand-new-long-password" })
      .expect(204);
    expect(changed.status).toBe(204);

    // The phone is out; the laptop that changed the password is still in.
    await phone.agent.get("/api/admin/settings").expect(401);
    await laptop.get("/api/admin/settings").expect(200);
  });
});
