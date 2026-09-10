import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, userEvent } from "@/test-utils";
import { DesignForm } from "./DesignForm";
import styles from "./Postcard.module.css";

/**
 * jsdom never decodes an image, so `Image.onload` is stubbed to fire the
 * moment `src` is set — enough to get past `choose()` and reach the message
 * column, which is what these tests are actually about.
 */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 1275;
  naturalHeight = 1875;
  set src(_value: string) {
    this.onload?.();
  }
}

async function pickPhoto() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("file input not found");
  const file = new File(["x"], "photo.png", { type: "image/png" });
  await userEvent.upload(input, file);
}

/**
 * The message column's height is fixed — an inch measurement, not
 * content-driven — so jsdom's real (always-zero) `scrollHeight`/
 * `clientHeight` say nothing about overflow either way. Stub both directly
 * on the column so `PostcardBackMock`'s next measurement reads whichever
 * case this test wants.
 */
function stubFit(fits: boolean) {
  const column = document.querySelector<HTMLElement>(`.${styles.backText}`);
  if (!column) throw new Error("message column not found");
  Object.defineProperty(column, "clientHeight", { configurable: true, value: 100 });
  Object.defineProperty(column, "scrollHeight", { configurable: true, value: fits ? 100 : 200 });
}

beforeEach(() => {
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:mock", revokeObjectURL: () => {} });
});

describe("DesignForm", () => {
  it("warns and disables Save when the note overflows the card, and clears when it fits again", async () => {
    renderWithProviders(<DesignForm onSaved={() => {}} />);
    await pickPhoto();

    const save = screen.getByRole("button", { name: "Save this design" });
    const note = screen.getByLabelText("Note for the back");

    expect(screen.queryByText("That's more than fits on the card")).not.toBeInTheDocument();
    expect(save).toBeEnabled();

    stubFit(false);
    await userEvent.type(note, " ");

    expect(screen.getByText("That's more than fits on the card")).toBeInTheDocument();
    expect(save).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Shorten the note, or choose a smaller size.");

    stubFit(true);
    await userEvent.type(note, " ");

    expect(screen.queryByText("That's more than fits on the card")).not.toBeInTheDocument();
    expect(save).toBeEnabled();
  });

  it("behaves exactly as before when the note fits: no warning, Save stays enabled", async () => {
    renderWithProviders(<DesignForm onSaved={() => {}} />);
    await pickPhoto();

    stubFit(true);
    await userEvent.type(screen.getByLabelText("Note for the back"), "Wish you were here.");

    expect(screen.queryByText("That's more than fits on the card")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save this design" })).toBeEnabled();
  });
});
