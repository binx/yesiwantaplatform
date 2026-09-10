import { describe, expect, it } from "vitest";
import Handlebars from "handlebars";
import sharp from "sharp";
import { CARD_FONTS_URL } from "../shared/postcards.js";
import { LobError, cropToCard, printFile, renderBack, retryAfterMs } from "./lob.js";

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

describe("cropToCard", () => {
  async function halves() {
    // Left half green, right half blue.
    return sharp({ create: { width: 4000, height: 1000, channels: 3, background: "#00ff00" } })
      .composite([{ input: await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#0000ff" } }).png().toBuffer(), left: 2000, top: 0 }])
      .png()
      .toBuffer();
  }

  async function corners(bytes: Buffer) {
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => data.subarray((y * info.width + x) * info.channels, (y * info.width + x + 1) * info.channels);
    return { left: at(0, 0), right: at(info.width - 1, 0), width: info.width, height: info.height };
  }

  it("pins the left edge at x 0 and the right edge at x 1, at either orientation", async () => {
    const source = await halves();

    const pinnedLeft = await corners(await cropToCard(source, "landscape", { x: 0, y: 0.5, zoom: 1 }));
    expect([pinnedLeft.width, pinnedLeft.height]).toEqual([1875, 1275]);
    expect(pinnedLeft.left[1]).toBeGreaterThan(200);
    expect(pinnedLeft.right[1]).toBeGreaterThan(200);

    const pinnedRight = await corners(await cropToCard(source, "landscape", { x: 1, y: 0.5, zoom: 1 }));
    expect(pinnedRight.left[2]).toBeGreaterThan(200);
    expect(pinnedRight.right[2]).toBeGreaterThan(200);

    const portrait = await corners(await cropToCard(source, "portrait", { x: 0, y: 0.5, zoom: 1 }));
    expect([portrait.width, portrait.height]).toEqual([1275, 1875]);
    expect(portrait.right[1]).toBeGreaterThan(200);
  });

  it("zooms in on the middle at zoom 2", async () => {
    const source = await halves();
    // Centre crop at zoom 2 spans the middle quarter of the source: still half green, half blue.
    const zoomed = await corners(await cropToCard(source, "landscape", { x: 0.5, y: 0.5, zoom: 2 }));
    expect(zoomed.left[1]).toBeGreaterThan(200);
    expect(zoomed.right[2]).toBeGreaterThan(200);
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

  it("draws the reply QR only when the card has a code", async () => {
    const back = { text: "Hi", valediction: "", fontName: "Quicksand", fontSize: 12, fontColor: "#000000" };
    const withCode = await renderBack(back, "https://postcards.example/r/AB7X3KQM");
    expect(withCode).toContain("<svg");
    expect(withCode).toContain("Scan to see this card online");
    expect(withCode).not.toContain("https://postcards.example/r/AB7X3KQM");
    const without = await renderBack(back, null);
    expect(without).not.toContain("<svg");
    expect(without).not.toContain("Scan to see");
  });

  it("omits the closing line when there is none", async () => {
    const html = await renderBack({ text: "Just this.", valediction: "", fontName: "Quicksand", fontSize: 12, fontColor: "#000000" });
    expect(html).not.toContain("valediction\"");
  });

  it("loads all three faces from CARD_FONTS_URL, not a hardcoded string", async () => {
    const html = await renderBack({ text: "Hi", valediction: "", fontName: "Quicksand", fontSize: 12, fontColor: "#000000" });
    expect(html).toContain(Handlebars.escapeExpression(CARD_FONTS_URL));
  });

  it("anchors the message column to the top, so an overflow clips the end and not the opening", async () => {
    const html = await renderBack({ text: "Hi", valediction: "", fontName: "Quicksand", fontSize: 12, fontColor: "#000000" });
    expect(html).toContain("justify-content: flex-start");
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
