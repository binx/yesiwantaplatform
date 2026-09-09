import { describe, expect, it } from "vitest";
import { isLocalOrigin } from "./publicUrl";

describe("isLocalOrigin", () => {
  it("recognises the addresses only the server's own machine can reach", () => {
    expect(isLocalOrigin("http://localhost:5173")).toBe(true);
    expect(isLocalOrigin("http://127.0.0.1:4000")).toBe(true);
    expect(isLocalOrigin("http://[::1]:5173")).toBe(true);
  });

  it("leaves a real address alone, including one that merely mentions localhost", () => {
    expect(isLocalOrigin("https://shop.example.com")).toBe(false);
    expect(isLocalOrigin("https://localhost.example.com")).toBe(false);
    expect(isLocalOrigin("https://shop.example.com/localhost")).toBe(false);
  });

  it("does not call an unparseable value local", () => {
    // A different problem with a different owner: `server/env.ts` refuses to
    // boot on one, so neither screen that asks this ever renders with it.
    expect(isLocalOrigin("not a url")).toBe(false);
    expect(isLocalOrigin("")).toBe(false);
  });
});
