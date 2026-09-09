import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Boot-time validation of the bucket settings.
 *
 * `server/env.ts` runs on import, so each case resets the module registry
 * and imports it afresh. The point is the message: a half-configured bucket
 * must fail at boot naming the variable, not as a 500 on the first upload.
 */

const GROUP = [
  "ASSETS_S3_BUCKET",
  "ASSETS_S3_ENDPOINT",
  "ASSETS_S3_REGION",
  "ASSETS_S3_ACCESS_KEY_ID",
  "ASSETS_S3_SECRET_ACCESS_KEY",
  "ASSETS_S3_ACL",
  "ASSETS_PUBLIC_URL",
];

function configure(values: Record<string, string>) {
  for (const name of GROUP) delete process.env[name];
  Object.assign(process.env, values);
  vi.resetModules();
}

afterEach(() => configure({}));

describe("object storage settings", () => {
  it("are off when nothing is set", async () => {
    configure({});
    const { objectStorage } = await import("./env.js");
    expect(objectStorage).toBeNull();
  });

  it("refuse a bucket without credentials, naming what is missing", async () => {
    configure({ ASSETS_S3_BUCKET: "shop", ASSETS_S3_REGION: "auto" });

    await expect(import("./env.js")).rejects.toThrow(
      /ASSETS_S3_ACCESS_KEY_ID, ASSETS_S3_SECRET_ACCESS_KEY, ASSETS_PUBLIC_URL are not/,
    );
  });

  it("refuse credentials without a bucket, rather than quietly writing to disk", async () => {
    configure({ ASSETS_S3_ACCESS_KEY_ID: "AKIA", ASSETS_S3_SECRET_ACCESS_KEY: "s" });

    await expect(import("./env.js")).rejects.toThrow(/ASSETS_S3_BUCKET is not/);
  });

  it("treat a blank value as unset", async () => {
    configure({ ASSETS_S3_BUCKET: "", ASSETS_S3_REGION: "" });

    const { objectStorage } = await import("./env.js");
    expect(objectStorage).toBeNull();
  });

  it("refuse a public URL that is not one", async () => {
    configure({
      ASSETS_S3_BUCKET: "shop",
      ASSETS_S3_REGION: "auto",
      ASSETS_S3_ACCESS_KEY_ID: "AKIA",
      ASSETS_S3_SECRET_ACCESS_KEY: "s",
      ASSETS_PUBLIC_URL: "cdn.example.com/images",
    });

    await expect(import("./env.js")).rejects.toThrow(/ASSETS_PUBLIC_URL must be an absolute URL/);
  });

  it("expose the whole group once it is complete", async () => {
    configure({
      ASSETS_S3_BUCKET: "shop",
      ASSETS_S3_REGION: "nyc3",
      ASSETS_S3_ENDPOINT: "https://nyc3.digitaloceanspaces.com",
      ASSETS_S3_ACCESS_KEY_ID: "AKIA",
      ASSETS_S3_SECRET_ACCESS_KEY: "s",
      ASSETS_S3_ACL: "public-read",
      ASSETS_PUBLIC_URL: "https://shop.nyc3.cdn.digitaloceanspaces.com",
    });

    const { objectStorage } = await import("./env.js");
    expect(objectStorage).toEqual({
      bucket: "shop",
      region: "nyc3",
      endpoint: "https://nyc3.digitaloceanspaces.com",
      accessKeyId: "AKIA",
      secretAccessKey: "s",
      acl: "public-read",
      publicUrl: "https://shop.nyc3.cdn.digitaloceanspaces.com",
    });
  });
});
