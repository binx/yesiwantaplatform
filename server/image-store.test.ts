import { access } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import sharp from "sharp";
import { DERIVATIVE_WIDTHS, derivativePath } from "../shared/images.js";

/**
 * The bucket driver.
 *
 * Nothing here reaches a network: `fetch` is replaced with a recorder that
 * answers 200, so what is tested is what the driver sends — signed PUTs for
 * the original and every derivative, DELETEs for all of them — and what the
 * server does around it: `/assets/<path>` redirects to the bucket, a file on
 * disk still wins, and the CSP admits the bucket's origin. `server/env.ts`
 * reads the environment on first import, so the variables are set before any
 * server module loads, the way server/assets-dir.test.ts does.
 */

const BUCKET_ORIGIN = "https://cdn.example.test";
const ENDPOINT = "https://s3.example.test";
const BUCKET = "beluga-test";
const PASSWORD = "a-sufficiently-long-test-password";

interface Sent {
  method: string;
  url: string;
  headers: Headers;
  body: Buffer;
}

const sent: Sent[] = [];
const ok = () => new Response(null, { status: 200 });
let answer: () => Response = ok;

let app: Express;

beforeAll(async () => {
  process.env.ASSETS_S3_BUCKET = BUCKET;
  process.env.ASSETS_S3_ENDPOINT = ENDPOINT;
  process.env.ASSETS_S3_REGION = "auto";
  process.env.ASSETS_S3_ACCESS_KEY_ID = "AKIATESTKEY";
  process.env.ASSETS_S3_SECRET_ACCESS_KEY = "test-secret";
  // With a trailing slash, which must not produce `//` in the URLs built from it.
  process.env.ASSETS_PUBLIC_URL = `${BUCKET_ORIGIN}/`;

  vi.stubGlobal("fetch", async (input: Request) => {
    sent.push({
      method: input.method,
      url: input.url,
      headers: input.headers,
      body: Buffer.from(await input.arrayBuffer()),
    });
    return answer();
  });

  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createAdmin } = await import("./auth.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  await createAdmin("bucket@example.com", PASSWORD);
  app = createApp();
});

afterAll(() => {
  vi.unstubAllGlobals();
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("ASSETS_S3_") || name === "ASSETS_PUBLIC_URL") delete process.env[name];
  }
});

afterEach(() => {
  sent.length = 0;
  answer = ok;
});

async function signIn() {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);
  const login = await agent
    .post("/api/session")
    .set("x-csrf-token", bootstrap.body.csrfToken as string)
    .send({ email: "bucket@example.com", password: PASSWORD })
    .expect(200);
  return { agent, csrf: login.body.csrfToken as string };
}

function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#123456" } })
    .png()
    .toBuffer();
}

const objectUrl = (relativePath: string) => `${ENDPOINT}/${BUCKET}/${relativePath}`;

describe("the bucket driver", () => {
  it("is selected by ASSETS_S3_BUCKET and builds public URLs from ASSETS_PUBLIC_URL", async () => {
    const { imageStore } = await import("./image-store.js");

    expect(imageStore.driver).toBe("s3");
    expect(imageStore.publicUrl("demo/tote-front.svg")).toBe(`${BUCKET_ORIGIN}/demo/tote-front.svg`);
    expect(imageStore.describe()).toContain(BUCKET);
  });

  it("uploads the original and every derivative to the bucket, and nothing to disk", async () => {
    const { ASSETS_ROOT } = await import("./image-store.js");
    const { agent, csrf } = await signIn();

    const uploaded = await agent
      .post("/api/admin/products/demo-tote/images")
      .set("x-csrf-token", csrf)
      .attach("file", await png(900, 600), { filename: "tote.png", contentType: "image/png" })
      .expect(201);

    const relativePath = uploaded.body.path as string;
    const widths = uploaded.body.widths as number[];
    expect(widths).toEqual([400, 800]);

    const puts = sent.filter((s) => s.method === "PUT");
    expect(puts.map((s) => s.url).sort()).toEqual(
      [relativePath, ...widths.map((w) => derivativePath(relativePath, w))].map(objectUrl).sort(),
    );

    for (const put of puts) {
      expect(put.headers.get("content-type")).toBe("image/webp");
      // Signature V4 with the configured key; the secret never appears.
      expect(put.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATESTKEY\//);
      expect(put.headers.get("authorization")).not.toContain("test-secret");
      expect(put.body.length).toBeGreaterThan(0);
    }

    // The bytes sent are the resized derivative, not the original again.
    const small = puts.find((s) => s.url === objectUrl(derivativePath(relativePath, 400)))!;
    expect((await sharp(small.body).metadata()).width).toBe(400);

    await expect(access(path.join(ASSETS_ROOT, relativePath))).rejects.toThrow();
  });

  it("deletes the original and every derivative name", async () => {
    const { agent, csrf } = await signIn();

    const uploaded = await agent
      .post("/api/admin/products/demo-tote/images")
      .set("x-csrf-token", csrf)
      .attach("file", await png(300, 200), { filename: "tote.png", contentType: "image/png" })
      .expect(201);
    const relativePath = uploaded.body.path as string;
    sent.length = 0;

    await agent
      .delete("/api/admin/products/demo-tote/images")
      .set("x-csrf-token", csrf)
      .send({ path: relativePath })
      .expect(204);

    // Every width, not only the ones generated: the database does not record
    // the derivatives individually, so the naming rule is what is deleted by.
    const deletes = sent.filter((s) => s.method === "DELETE").map((s) => s.url);
    expect(deletes.sort()).toEqual(
      [relativePath, ...DERIVATIVE_WIDTHS.map((w) => derivativePath(relativePath, w))].map(objectUrl).sort(),
    );
  });

  it("turns a refused PUT into a failed upload, not a half-stored image", async () => {
    const { agent, csrf } = await signIn();
    answer = () => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 });

    await agent
      .post("/api/admin/products/demo-tote/images")
      .set("x-csrf-token", csrf)
      .attach("file", await png(900, 600), { filename: "tote.png", contentType: "image/png" })
      .expect(500);

    // Stopped at the first failure rather than carrying on with derivatives.
    expect(sent.filter((s) => s.method === "PUT")).toHaveLength(1);
  });
});

describe("/assets under the bucket driver", () => {
  it("redirects to the bucket, with a cache header so the hop is paid once", async () => {
    const response = await request(app).get("/assets/some-owner/abc.webp").expect(302);

    expect(response.headers.location).toBe(`${BUCKET_ORIGIN}/some-owner/abc.webp`);
    expect(response.headers["cache-control"]).toBeDefined();
  });

  it("still serves a file that is on disk", async () => {
    // The bundled demo images live in public/assets and are not in the bucket.
    const response = await request(app).get("/assets/demo/tote-front.svg").expect(200);
    expect(response.headers["content-type"]).toMatch(/svg/);
  });

  it("does not redirect a traversal or a dotfile", async () => {
    await request(app).get("/assets/..%2Fescape.webp").expect(404);
    await request(app).get("/assets/owner/.env").expect(404);
  });

  it("lists the bucket origin in the CSP img-src", async () => {
    const response = await request(app).get("/api/store").expect(200);
    const csp = response.headers["content-security-policy"] as string;

    expect(csp).toMatch(new RegExp(`img-src [^;]*${BUCKET_ORIGIN.replace(/\./g, "\\.")}`));
  });
});

describe("createS3Store", () => {
  const options = {
    bucket: "shop-images",
    region: "us-east-1",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret",
    publicUrl: "https://images.example.com",
  };

  function recorder() {
    const requests: Request[] = [];
    const fetch = (request: Request) => {
      requests.push(request);
      return Promise.resolve(new Response(null, { status: 200 }));
    };
    return { requests, fetch };
  }

  it("addresses AWS itself virtual-hosted style when no endpoint is given", async () => {
    const { createS3Store } = await import("./image-store.js");
    const { requests, fetch } = recorder();

    await createS3Store({ ...options, fetch }).put("owner/a.webp", Buffer.from("x"), "image/webp");

    expect(requests[0]!.url).toBe("https://shop-images.s3.us-east-1.amazonaws.com/owner/a.webp");
    expect(requests[0]!.headers.get("x-amz-acl")).toBeNull();
  });

  it("addresses a custom endpoint path-style, and sends the ACL when one is set", async () => {
    const { createS3Store } = await import("./image-store.js");
    const { requests, fetch } = recorder();

    await createS3Store({
      ...options,
      endpoint: "https://nyc3.digitaloceanspaces.com/",
      acl: "public-read",
      fetch,
    }).put("owner/a.webp", Buffer.from("x"), "image/webp");

    expect(requests[0]!.url).toBe("https://nyc3.digitaloceanspaces.com/shop-images/owner/a.webp");
    expect(requests[0]!.headers.get("x-amz-acl")).toBe("public-read");
  });

  it("treats a 404 on delete as already gone, and anything else as an error", async () => {
    const { createS3Store } = await import("./image-store.js");
    let status = 404;
    const store = createS3Store({
      ...options,
      fetch: () => Promise.resolve(new Response("nope", { status })),
    });

    await expect(store.delete("owner/a.webp")).resolves.toBeUndefined();

    status = 500;
    await expect(store.delete("owner/a.webp")).rejects.toThrow(/answered 500 \(nope\)/);
  });

  it("refuses a key outside the tree before signing anything", async () => {
    const { createS3Store } = await import("./image-store.js");
    const { requests, fetch } = recorder();
    const store = createS3Store({ ...options, fetch });

    await expect(store.put("../escape", Buffer.from("x"), "image/webp")).rejects.toThrow(/outside/);
    expect(() => store.publicUrl("/etc/passwd")).toThrow(/outside/);
    expect(requests).toHaveLength(0);
  });
});
