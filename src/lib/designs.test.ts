import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostcardBack, PostcardDesign } from "@shared/postcards";
import { updateDesignBack } from "./designs";

const back: PostcardBack = { text: "Miss you lots", valediction: "Love, Rachel", fontName: "Patrick Hand", fontSize: 24, fontColor: "#000000" };
const design: PostcardDesign = {
  id: "abc-123",
  orientation: "portrait",
  thumbnail: { path: "designs/abc-123/thumb.webp", width: 408, height: 600, alt: "", widths: [] },
  back,
  createdAt: 0,
};

describe("updateDesignBack", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PUTs the back as plain JSON, no CSRF token, and parses the updated design back", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(design), { status: 200 }));

    const result = await updateDesignBack({ id: "abc-123", back });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/designs/abc-123",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify(back),
      }),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(Object.keys(init.headers as Record<string, string>)).not.toContain("x-csrf-token");
    expect(result).toEqual(design);
  });

  it("surfaces the server's 409 message when the design has already been ordered", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "That postcard has already been ordered and cannot be changed." }), { status: 409 }),
    );

    await expect(updateDesignBack({ id: "abc-123", back })).rejects.toMatchObject({
      message: "That postcard has already been ordered and cannot be changed.",
      status: 409,
    });
  });
});
