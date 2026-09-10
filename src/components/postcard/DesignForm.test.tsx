import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PostcardDesign } from "@shared/postcards";
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
  it("opens the file picker when the empty frame is clicked", async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    renderWithProviders(<DesignForm onSaved={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /Add a photo/ }));

    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it("drops the frame's button once a photo is in it", async () => {
    renderWithProviders(<DesignForm onSaved={() => {}} />);
    expect(screen.getByRole("button", { name: /Add a photo/ })).toBeInTheDocument();

    await pickPhoto();

    expect(screen.queryByRole("button", { name: /Add a photo/ })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Drag it, or use the arrow keys/ })).toBeInTheDocument();
  });


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

describe("DesignForm editing a saved design", () => {
  const design: PostcardDesign = {
    id: "abc-123",
    orientation: "portrait",
    thumbnail: { path: "designs/abc-123/thumb.webp", width: 408, height: 600, alt: "", widths: [] },
    back: { text: "Miss you lots", valediction: "Love, Rachel", fontName: "Patrick Hand", fontSize: 24, fontColor: "#000000" },
    createdAt: 0,
  };

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("seeds the back from the design, hides the upload controls, and shows the saved thumbnail", () => {
    renderWithProviders(<DesignForm onSaved={() => {}} editing={design} />);

    expect(screen.getByDisplayValue("Miss you lots")).toBeInTheDocument();
    expect(screen.getByText("To change the photo, remove this design and save a new one.")).toBeInTheDocument();
    expect(screen.queryByText("Upload a photo")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Portrait" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("saves changes through the update hook and hands the parsed design to onEdited", async () => {
    const updated: PostcardDesign = { ...design, back: { ...design.back, text: "Miss you lots!" } };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(updated), { status: 200 }));
    const onEdited = vi.fn();

    renderWithProviders(<DesignForm onSaved={() => {}} editing={design} onEdited={onEdited} />);
    stubFit(true);
    await userEvent.type(screen.getByLabelText("Note for the back"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/designs/abc-123", expect.objectContaining({ method: "PUT" }));
    await screen.findByText("Updated.");
    expect(onEdited).toHaveBeenCalledWith(updated);
  });

  it("shows the server's 409 message with the removal hint, and does not clear the note", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "That design has already been ordered and cannot be changed." }), { status: 409 }),
    );

    renderWithProviders(<DesignForm onSaved={() => {}} editing={design} />);
    stubFit(true);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText(
        "That design has already been ordered and cannot be changed. Remove it from the schedule and save a fresh copy to change the note.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Miss you lots")).toBeInTheDocument();
  });

  it("Cancel restores a blank form and calls onCancelEdit without touching the design", async () => {
    const onCancelEdit = vi.fn();
    renderWithProviders(<DesignForm onSaved={() => {}} editing={design} onCancelEdit={onCancelEdit} />);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancelEdit).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
