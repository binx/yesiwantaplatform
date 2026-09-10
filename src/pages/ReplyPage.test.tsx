import { describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";
import type { ReplyCard } from "@shared/reply";
import { storeSchema } from "@shared/schema";
import { demoStore } from "@shared/demo-store";
import { renderWithProviders, screen, waitFor } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { ReplyPage } from "./ReplyPage";

/** The page behind the QR: the card, one tap to say it arrived, and the way back. */
const { fetchReplyCard, sendReaction } = vi.hoisted(() => ({ fetchReplyCard: vi.fn(), sendReaction: vi.fn() }));
vi.mock("@/lib/reply", () => ({ fetchReplyCard, sendReaction }));

const card: ReplyCard = {
  front: { path: "designs/d1/thumb.webp", width: 600, height: 408, alt: "", widths: [] },
  orientation: "landscape",
  back: { text: "Wish you were here 🎉", valediction: "Love, R", fontName: "Sacramento", fontSize: 24, fontColor: "#000000" },
  senderName: "Rachel",
  mailedOn: "2026-09-14",
  canReply: true,
  reaction: null,
};

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/r/:code" element={<ReplyPage />} />
    </Routes>,
    { route: "/r/AB7X3KQM", store: storeSchema.parse(demoStore) },
  );
}

describe("ReplyPage", () => {
  it("shows the card without its emoji, takes a reaction, and links to a reply", async () => {
    fetchReplyCard.mockResolvedValue(card);
    sendReaction.mockResolvedValue(undefined);
    renderPage();

    expect(await screen.findByRole("heading", { name: "A postcard for you, from Rachel" })).toBeInTheDocument();
    expect(screen.getByText("Wish you were here")).toBeInTheDocument();
    expect(screen.queryByText(/🎉/)).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "React with ❤️" }));
    await user.type(screen.getByLabelText("A note"), "On the fridge");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendReaction).toHaveBeenCalledWith("AB7X3KQM", { emoji: "❤️", note: "On the fridge" }));
    expect(await screen.findByText(/Sent to Rachel/)).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Send a postcard back/ })).toHaveAttribute("href", "/create?replyTo=AB7X3KQM");
  });

  it("offers no reply when the sender has not allowed one, and says so plainly for an unknown code", async () => {
    fetchReplyCard.mockResolvedValue({ ...card, senderName: null, canReply: false });
    renderPage();
    expect(await screen.findByRole("heading", { name: "A postcard for you" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Send a postcard back/ })).not.toBeInTheDocument();

    const { ApiError } = await import("@/lib/api");
    fetchReplyCard.mockRejectedValue(new ApiError("There's no postcard here.", 404));
    renderPage();
    expect(await screen.findByRole("heading", { name: "There's no postcard here" })).toBeInTheDocument();
  });
});
