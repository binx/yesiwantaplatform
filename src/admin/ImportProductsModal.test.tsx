import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, userEvent, waitFor, within } from "@/test-utils";
import { ImportProductsModal } from "./ImportProductsModal";
import type { ImportPreview } from "./queries";

/**
 * The import screen.
 *
 * What is worth asserting is the two-phase contract the brief insists on:
 * choosing a file previews and writes nothing, every error is shown at once
 * with its row and column, and the commit is refused until the merchant either
 * fixes the file or explicitly opts into skipping rows.
 */

const csvFile = (text: string) => {
  const file = new File([text], "catalogue.csv", { type: "text/csv" });

  // jsdom's Blob has no text(); every browser this ships to has had it since
  // 2020, so the polyfill belongs here rather than in the component.
  if (typeof file.text !== "function") {
    Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
  }

  return file;
};

/** Answer the two import endpoints; record what was actually sent. */
function mockApi(preview: Partial<ImportPreview>) {
  const commits: string[] = [];

  const json = (body: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);

    if (url.endsWith("/api/session")) return json({ csrfToken: "token" });

    if (url.includes("/import/validate")) {
      return json({
        rows: 0,
        creates: 0,
        updates: 0,
        errors: [],
        errorsOmitted: 0,
        products: [],
        ...preview,
      } satisfies ImportPreview);
    }

    if (url.includes("/import/commit")) {
      commits.push(url);
      return json({ created: 1, updated: 0, skipped: 0 });
    }

    throw new Error(`Unexpected request to ${url}`);
  });

  // Assigned rather than stubbed: `vi.unstubAllGlobals` would also drop the
  // ResizeObserver and matchMedia stubs the antd components rely on, which
  // vitest.setup.ts installs once for the whole run.
  globalThis.fetch = fetchMock;
  return { commits };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function chooseFile(text = "slug,name,variant_price_cents\ntote,Tote,1000\n") {
  const user = userEvent.setup();
  renderWithProviders(<ImportProductsModal open onClose={() => undefined} />);

  await user.upload(screen.getByLabelText("Choose a CSV file to import"), csvFile(text));
  return user;
}

describe("ImportProductsModal", () => {
  it("previews without importing, and says nothing has changed yet", async () => {
    const { commits } = mockApi({
      rows: 2,
      creates: 1,
      updates: 1,
      products: [
        { slug: "tote", name: "Tote", action: "create", variants: 1, rows: [2], valid: true },
        { slug: "mug", name: "Mug", action: "update", variants: 1, rows: [3], valid: true },
      ],
    });

    await chooseFile();

    expect(await screen.findByText(/2 rows read: 1 to create, 1 to update/)).toBeInTheDocument();
    expect(screen.getByText(/nothing has been changed yet/i)).toBeInTheDocument();
    expect(commits).toHaveLength(0);
  });

  it("says an import never publishes to Stripe", async () => {
    mockApi({ rows: 1, creates: 1 });
    await chooseFile();

    expect(await screen.findByText(/never published to Stripe/i)).toBeInTheDocument();
  });

  it("lists every error with its row and column", async () => {
    mockApi({
      rows: 3,
      errors: [
        { row: 2, column: "variant_price_cents", message: "Must be a whole number of cents." },
        { row: 3, column: "slug", message: "Not a valid slug." },
        { row: 4, column: "option1_value", message: "Every row must give a value." },
      ],
    });

    await chooseFile();

    expect(await screen.findByText("Problems")).toBeInTheDocument();

    // Each error's row, column and message travel together, so the assertion
    // is per row rather than per cell — "slug" also appears in the drop hint.
    const expected = [
      ["2", "variant_price_cents", "Must be a whole number of cents."],
      ["3", "slug", "Not a valid slug."],
      ["4", "option1_value", "Every row must give a value."],
    ];

    for (const [row, column, message] of expected) {
      const cells = screen.getByText(message!).closest("tr");
      expect(within(cells!).getByText(row!)).toBeInTheDocument();
      expect(within(cells!).getByText(column!)).toBeInTheDocument();
    }
  });

  it("refuses to import while the file has errors, until skipping is chosen", async () => {
    const { commits } = mockApi({
      rows: 2,
      creates: 1,
      errors: [{ row: 3, column: "slug", message: "Not a valid slug." }],
      products: [
        { slug: "tote", name: "Tote", action: "create", variants: 1, rows: [2], valid: true },
        { slug: "", name: "Bad", action: "create", variants: 1, rows: [3], valid: false },
      ],
    });

    const user = await chooseFile();

    const skip = await screen.findByRole("checkbox", { name: /skipping the ones listed above/i });
    // Defaulted off: skipping rows is never the quiet default.
    expect(skip).not.toBeChecked();

    const importButton = screen.getByRole("button", { name: /^Import/ });
    expect(importButton).toBeDisabled();

    await user.click(skip);
    await waitFor(() => expect(importButton).toBeEnabled());

    await user.click(importButton);
    await waitFor(() => expect(commits).toHaveLength(1));
    expect(commits[0]).toContain("skipInvalid=true");
  });

  it("commits without the skip flag when the file is clean", async () => {
    const { commits } = mockApi({
      rows: 1,
      creates: 1,
      products: [{ slug: "tote", name: "Tote", action: "create", variants: 1, rows: [2], valid: true }],
    });

    const user = await chooseFile();

    const importButton = await screen.findByRole("button", { name: /Import 1 product/ });
    await user.click(importButton);

    await waitFor(() => expect(commits).toHaveLength(1));
    expect(commits[0]).not.toContain("skipInvalid");
  });

  it("marks a product that will be skipped", async () => {
    mockApi({
      rows: 2,
      creates: 1,
      errors: [{ row: 3, column: "slug", message: "Not a valid slug." }],
      products: [
        { slug: "tote", name: "Tote", action: "create", variants: 1, rows: [2], valid: true },
        { slug: "bad", name: "Bad", action: "create", variants: 1, rows: [3], valid: false },
      ],
    });

    await chooseFile();

    const changes = await screen.findByText("What will change");
    expect(changes).toBeInTheDocument();

    const badRow = screen.getByText("Bad").closest("tr");
    expect(within(badRow!).getByText("Skipped")).toBeInTheDocument();
  });
});
