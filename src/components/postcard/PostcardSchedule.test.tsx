import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Order } from "@shared/orders";
import { renderWithProviders, screen, within } from "@/test-utils";
import { PostcardSchedule } from "./PostcardSchedule";

/**
 * The order table a buyer sees, with where a sent card has got to.
 */
const order: Pick<Order, "postcards" | "designs"> = {
  designs: [],
  postcards: [
    {
      id: "p1",
      designId: "d1",
      batchIndex: 0,
      recipient: { name: "Grandma", line1: "1 Test Street", line2: null, city: "Marfa", state: "TX", postalCode: "79843", country: "US" },
      mailDate: "2026-09-14",
      status: "sent",
      lobId: "psc_1",
      lobUrl: null,
      expectedDeliveryDate: "2026-09-19",
      sentAt: Date.parse("2026-09-14T12:00:00Z"),
      attempts: 1,
      lastError: null,
      trackingStatus: "postcard.processed_for_delivery",
      replyCode: "AB7X3KQM",
      isReply: false,
      reaction: { emoji: "❤️", note: "Fridge status: achieved", at: Date.parse("2026-09-19T12:00:00Z") },
      replies: null,
      tracking: [
        { type: "postcard.in_transit", occurredAt: Date.parse("2026-09-15T12:00:00Z"), location: null },
        { type: "postcard.in_local_area", occurredAt: Date.parse("2026-09-17T12:00:00Z"), location: null },
        { type: "postcard.processed_for_delivery", occurredAt: Date.parse("2026-09-18T12:00:00Z"), location: null },
      ],
    },
    {
      id: "p2",
      designId: "d1",
      batchIndex: 0,
      recipient: { name: "Grandpa", line1: "1 Test Street", line2: null, city: "Marfa", state: "TX", postalCode: "79843", country: "US" },
      mailDate: "2026-09-21",
      status: "scheduled",
      lobId: null,
      lobUrl: null,
      expectedDeliveryDate: null,
      sentAt: null,
      attempts: 0,
      lastError: null,
      trackingStatus: null,
      tracking: [],
      replyCode: null,
      isReply: false,
      reaction: null,
      replies: null,
    },
  ],
};

describe("PostcardSchedule", () => {
  it("shows a sent card's scans in order, in plain words, and nothing for a card still waiting", () => {
    renderWithProviders(<PostcardSchedule order={order} locale="en-US" />);

    const timeline = screen.getByRole("list", { name: "Delivery progress" });
    const steps = within(timeline).getAllByRole("listitem").map((item) => item.textContent);
    expect(steps).toEqual(["Sep 15In transit", "Sep 17Near its destination", "Sep 18Out for delivery"]);
    expect(screen.getAllByRole("list", { name: "Delivery progress" })).toHaveLength(1);
    expect(screen.getByText("Expected Sep 19, 2026")).toBeInTheDocument();
    expect(screen.queryByText(/postcard\./)).not.toBeInTheDocument();
  });

  it("shows what came back through the code, keeps a reply's address private, and offers to turn a live code off", async () => {
    const onDisableReply = vi.fn();
    const withReplies: typeof order = {
      designs: [],
      postcards: [
        { ...order.postcards[0]!, replies: { onTheWay: 1, delivered: 0, thumbnail: null } },
        { ...order.postcards[1]!, id: "p3", isReply: true, recipient: { ...order.postcards[1]!.recipient, name: "Rachel", line1: "" } },
      ],
    };
    renderWithProviders(<PostcardSchedule order={withReplies} locale="en-US" onDisableReply={onDisableReply} />);

    expect(screen.getByText(/Fridge status: achieved/)).toBeInTheDocument();
    expect(screen.getByText("A reply is on its way")).toBeInTheDocument();
    expect(screen.getByText("Address kept private")).toBeInTheDocument();
    expect(screen.queryByText(/, Marfa, TX 79843$/)).toHaveTextContent("1 Test Street, Marfa, TX 79843");

    const buttons = screen.getAllByRole("button", { name: "Turn off the link" });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]!);
    await userEvent.click(await screen.findByRole("button", { name: "OK" }));
    expect(onDisableReply).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
  });
});
