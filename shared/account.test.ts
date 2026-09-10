import { describe, expect, it } from "vitest";
import { customerRegisterInputSchema } from "./account.js";

const base = { email: "shopper@example.com", password: "a-sufficiently-long-test-password" };

describe("customerRegisterInputSchema", () => {
  it("keeps a same-site next path", () => {
    expect(customerRegisterInputSchema.parse({ ...base, next: "/cart" }).next).toBe("/cart");
  });

  it("drops an absolute or protocol-relative next rather than rejecting the request", () => {
    expect(customerRegisterInputSchema.parse({ ...base, next: "https://evil.example" }).next).toBeNull();
    expect(customerRegisterInputSchema.parse({ ...base, next: "//evil.example" }).next).toBeNull();
  });

  it("defaults next to null when omitted", () => {
    expect(customerRegisterInputSchema.parse(base).next).toBeNull();
  });
});
