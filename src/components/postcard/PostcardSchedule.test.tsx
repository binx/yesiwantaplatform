import { describe, expect, it } from "vitest";
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
});
