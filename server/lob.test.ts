import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { LobError, printFile, renderBack, retryAfterMs } from "./lob.js";

/**
 * The print file and the back, checked as arithmetic.
 *
 * These are the two things v1 got wrong without ever being told: a PNG with
 * no density that Lob read as 72 dpi, and a back that was whatever the Lob
 * template happened to hold.
 */
describe("printFile", () => {
  it("writes a landscape file at Lob's size with 300 dpi declared, whatever came in", async () => {
    const tall = await sharp({ create: { width: 800, height: 1600, channels: 3, background: "#ff0000" } }).png().toBuffer();

    const portrait = await printFile(tall, "portrait");
    const meta = await sharp(portrait.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([1875, 1275]);
    expect(meta.density).toBe(300);
    expect(meta.format).toBe("png");

    const landscape = await printFile(tall, "landscape");
    const landscapeMeta = await sharp(landscape.bytes).metadata();
    expect([landscapeMeta.width, landscapeMeta.height]).toEqual([1875, 1275]);
  });

  it("centre-crops rather than squashing", async () => {
    // Left half green, right half blue: a squash keeps both, a crop keeps the middle.
    const source = await sharp({ create: { width: 4000, height: 1000, channels: 3, background: "#00ff00" } })
      .composite([{ input: await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#0000ff" } }).png().toBuffer(), left: 2000, top: 0 }])
      .png()
      .toBuffer();

    const { bytes } = await printFile(source, "landscape");
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    // Flattened onto white, so no alpha channel reaches the printer.
    expect(info.channels).toBe(3);
    // Pixel at the far left of the print: from the middle of the source, still green.
    const left = data.subarray(0, info.channels);
    const right = data.subarray((info.width - 1) * info.channels, info.width * info.channels);
    expect(left[1]).toBeGreaterThan(200);
    expect(right[2]).toBeGreaterThan(200);
  });
});

describe("renderBack", () => {
  it("escapes markup and strips emoji from the message", async () => {
    const html = await renderBack({
      text: "Hello <b>Grandma</b> 🎉",
      valediction: "Love, R 💌",
      fontName: "Sacramento",
      fontSize: 20,
      fontColor: "#123456",
    });

    expect(html).toContain("Hello &lt;b&gt;Grandma&lt;/b&gt;");
    expect(html).not.toContain("🎉");
    expect(html).not.toContain("💌");
    expect(html).toContain("Sacramento");
    expect(html).toContain("20pt");
    expect(html).toContain("#123456");
  });

  it("omits the closing line when there is none", async () => {
    const html = await renderBack({ text: "Just this.", valediction: "", fontName: "Quicksand", fontSize: 12, fontColor: "#000000" });
    expect(html).not.toContain("valediction\"");
  });
});

describe("LobError", () => {
  it("tells a stall apart from a refusal", () => {
    expect(new LobError("limit", 429, null).stall).toBe(true);
    expect(new LobError("gone", 0, null).stall).toBe(true);
    expect(new LobError("bad gateway", 502, null).stall).toBe(false);
    expect(new LobError("bad gateway", 502, null).retryable).toBe(true);
    expect(new LobError("bad address", 422, "invalid").retryable).toBe(false);
  });

  it("reads Retry-After as seconds or as a date, and shrugs at anything else", () => {
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("3")).toBe(3000);
    const now = Date.parse("2026-09-10T00:00:00Z");
    expect(retryAfterMs("Thu, 10 Sep 2026 00:00:02 GMT", now)).toBe(2000);
    expect(retryAfterMs("Thu, 10 Sep 2026 00:00:00 GMT", now + 5000)).toBe(0);
    expect(retryAfterMs("soon")).toBeNull();
  });
});
