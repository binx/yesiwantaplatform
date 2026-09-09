import { describe, expect, it, vi } from "vitest";
import { defaultTheme, type Theme } from "@shared/schema";
import { renderWithProviders, screen, userEvent } from "@/test-utils";
import { ThemeEditor } from "./ThemeEditor";

const GOOGLE_FONTS_URL = "https://fonts.googleapis.com/css2?family=Fraunces&display=swap";

function renderEditor(theme: Theme, onChange = vi.fn()) {
  renderWithProviders(
    <ThemeEditor value={theme} onChange={onChange} storeName="Test Store" savedFontUrl={null} />,
  );
  return onChange;
}

describe("ThemeEditor", () => {
  it("labels the font stylesheet URL field", () => {
    renderEditor(defaultTheme);
    expect(screen.getByLabelText("Font stylesheet URL")).toBeInTheDocument();
  });

  it("says nothing when the URL's family is already in the stack", () => {
    renderEditor({ ...defaultTheme, fontFamily: '"Fraunces", serif', fontUrl: GOOGLE_FONTS_URL });
    expect(screen.queryByText(/does not use/)).not.toBeInTheDocument();
  });

  it("hints when the URL defines a family the stack never names, and the hint's button switches to it", async () => {
    const user = userEvent.setup();
    const onChange = renderEditor({ ...defaultTheme, fontUrl: GOOGLE_FONTS_URL });

    expect(
      screen.getByText("This stylesheet defines Fraunces, which the typeface above does not use."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Switch Typeface to Custom…" }));

    expect(onChange).toHaveBeenCalledWith({
      ...defaultTheme,
      fontUrl: GOOGLE_FONTS_URL,
      fontFamily: `"Fraunces", ${defaultTheme.fontFamily}`,
    });
  });

  it("says nothing for a URL it cannot read a family out of", () => {
    renderEditor({ ...defaultTheme, fontUrl: "/assets/fonts/fraunces.css" });
    expect(screen.queryByText(/does not use/)).not.toBeInTheDocument();
  });
});
