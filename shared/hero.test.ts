import { describe, expect, it } from "vitest";
import { heroHrefSchema, heroSchema } from "./schema.js";

/**
 * Where a hero button may point.
 *
 * This value ends up in an `href` the storefront renders for every visitor, so
 * the interesting assertions are the refusals. Both sides of the wire import
 * this schema — Settings blocks Save on it and the API refuses the request —
 * so there is one answer rather than two that can drift.
 */

describe("heroHrefSchema", () => {
  it("accepts a same-origin path", () => {
    for (const href of ["/shop", "/collection/home-goods", "/shop?sort=newest", "/"]) {
      expect(heroHrefSchema.safeParse(href).success).toBe(true);
    }
  });

  it("accepts an absolute https address", () => {
    expect(heroHrefSchema.safeParse("https://example.com/lookbook").success).toBe(true);
  });

  it("refuses javascript:, in every shape it is usually smuggled in", () => {
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "java\nscript:alert(1)",
    ]) {
      expect(heroHrefSchema.safeParse(href).success).toBe(false);
    }
  });

  it("refuses the other schemes that execute or embed", () => {
    for (const href of ["data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "file:///etc/passwd"]) {
      expect(heroHrefSchema.safeParse(href).success).toBe(false);
    }
  });

  it("refuses a protocol-relative URL, which leaves the store while looking local", () => {
    // `//evil.example` is not a path: a browser reads it as another origin on
    // the current scheme. It is the one case that looks like it starts with /.
    expect(heroHrefSchema.safeParse("//evil.example/free").success).toBe(false);
  });

  it("refuses plain http, so an https store cannot silently downgrade", () => {
    expect(heroHrefSchema.safeParse("http://example.com").success).toBe(false);
  });

  it("refuses a bare host, which is the honest mistake rather than an attack", () => {
    expect(heroHrefSchema.safeParse("example.com/lookbook").success).toBe(false);
  });
});

describe("heroSchema", () => {
  it("defaults every field to null, so an unset store falls back", () => {
    const hero = heroSchema.parse({});

    expect(hero).toEqual({
      heading: null,
      text: null,
      buttonLabel: null,
      buttonHref: null,
      image: null,
    });
  });

  it("refuses a bad href through the object, not only on its own", () => {
    expect(heroSchema.safeParse({ buttonHref: "javascript:alert(1)" }).success).toBe(false);
    expect(heroSchema.safeParse({ buttonHref: "/shop" }).success).toBe(true);
  });
});
