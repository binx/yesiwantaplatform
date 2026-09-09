import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderWithProviders, screen } from "@/test-utils";
import { CollectionsPage } from "./CollectionsPage";

/**
 * The introduction is the one field on this page driven through
 * `useAutosave` rather than saved immediately — see 32-admin-fixes. Typing
 * used to be lost on reload unless the field was blurred first, and nothing
 * on the page ever said the word "Saved".
 */

function mockApi() {
  let description: string | null = null;
  const puts: { description: string | null }[] = [];

  const json = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );

  const collection = () => ({
    id: "col-1",
    slug: "summer",
    name: "Summer",
    cover: null,
    productIds: [],
    description,
  });

  // Assigned rather than stubbed: `vi.unstubAllGlobals` would also drop the
  // matchMedia and observer stubs vitest.setup.ts installs once.
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/session")) return json({ csrfToken: "token" });
    if (url.endsWith("/api/admin/products")) return json([]);
    if (url.endsWith("/api/admin/collections") && method === "GET") return json([collection()]);

    if (url.endsWith("/api/admin/collections/col-1") && method === "PUT") {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
        description: string | null;
      };
      description = body.description;
      puts.push(body);
      return json(undefined, 204);
    }

    return json({});
  });

  return { puts };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function typeIntroduction(text: string) {
  const introduction = await screen.findByLabelText("Introduction");

  // Fake timers before the change, not after: `useAutosave`'s debounce timer
  // is scheduled the moment the value changes, and a real timer set before
  // switching can't be advanced by a fake clock started afterwards.
  vi.useFakeTimers();
  fireEvent.change(introduction, { target: { value: text } });

  // Past the 900ms debounce, and enough beyond it that a flaky boundary
  // doesn't fail the test.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });

  return introduction;
}

describe("the collection introduction", () => {
  it("saves itself shortly after typing stops, with no blur needed", async () => {
    const api = mockApi();
    renderWithProviders(<CollectionsPage />);

    await typeIntroduction("Small runs, made by hand.");

    expect(api.puts.at(-1)).toMatchObject({ description: "Small runs, made by hand." });
  });

  it("says Saved once the write lands", async () => {
    mockApi();
    renderWithProviders(<CollectionsPage />);

    await typeIntroduction("Small runs, made by hand.");

    expect(screen.getByText(/^Saved/)).toBeInTheDocument();
  });
});
