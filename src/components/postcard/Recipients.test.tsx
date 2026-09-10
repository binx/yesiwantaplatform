import { describe, expect, it, vi } from "vitest";
import type { Recipient, Verification } from "@shared/postcards";
import type * as RecipientsLib from "@/lib/recipients";
import { renderWithProviders, screen, userEvent, waitFor } from "@/test-utils";
import { Recipients } from "./Recipients";

/**
 * The form asks USPS before adding, and does what the buyer decides.
 */
const verifyRecipient = vi.fn<(recipient: Recipient) => Promise<Verification>>();

vi.mock("@/lib/recipients", async (importOriginal) => {
  const actual = await importOriginal<typeof RecipientsLib>();
  return { ...actual, verifyRecipient: (recipient: Recipient) => verifyRecipient(recipient) };
});

const TYPED: Recipient = { name: "Grandma", line1: "185 berry street", line2: null, city: "San Francisco", state: "CA", postalCode: "94107" };
const USPS: Recipient = { ...TYPED, line1: "185 Berry St" };

async function fillForm() {
  await userEvent.type(screen.getByLabelText("Name"), TYPED.name);
  await userEvent.type(screen.getByLabelText("Street address"), TYPED.line1);
  await userEvent.type(screen.getByLabelText("City"), TYPED.city);
  await userEvent.type(screen.getByLabelText("State"), TYPED.state);
  await userEvent.type(screen.getByLabelText("ZIP"), TYPED.postalCode);
  await userEvent.click(screen.getByRole("button", { name: "Add recipient" }));
}

describe("Recipients", () => {
  it("adds straight away when USPS agrees, or could not be asked", async () => {
    verifyRecipient.mockResolvedValue({ deliverability: "unknown", suggested: null, changed: false });
    const onChange = vi.fn();
    renderWithProviders(<Recipients recipients={[]} onChange={onChange} />);

    await fillForm();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([TYPED]));
  });

  it("offers USPS's form and adds it on 'Use this'", async () => {
    verifyRecipient.mockResolvedValue({ deliverability: "deliverable", suggested: USPS, changed: true });
    const onChange = vi.fn();
    renderWithProviders(<Recipients recipients={[]} onChange={onChange} />);

    await fillForm();
    expect(await screen.findByText("USPS knows this address as:")).toBeInTheDocument();
    expect(screen.getByText(/185 Berry St, San Francisco/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(onChange).toHaveBeenCalledWith([USPS]);
  });

  it("keeps the buyer's own on 'Keep mine'", async () => {
    verifyRecipient.mockResolvedValue({ deliverability: "deliverable", suggested: USPS, changed: true });
    const onChange = vi.fn();
    renderWithProviders(<Recipients recipients={[]} onChange={onChange} />);

    await fillForm();
    await userEvent.click(await screen.findByRole("button", { name: "Keep mine" }));
    expect(onChange).toHaveBeenCalledWith([TYPED]);
  });

  it("stops an address USPS does not know, and says why", async () => {
    verifyRecipient.mockResolvedValue({ deliverability: "undeliverable", suggested: null, changed: false });
    const onChange = vi.fn();
    renderWithProviders(<Recipients recipients={[]} onChange={onChange} />);

    await fillForm();
    expect(await screen.findByText("USPS doesn't recognise this address.")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    // The form still holds what was typed, ready to fix.
    expect(screen.getByLabelText("Street address")).toHaveValue(TYPED.line1);
  });

  it("checks a list that arrived without the form, and keeps a refused one out of the cart", async () => {
    verifyRecipient.mockImplementation((recipient) =>
      Promise.resolve(
        recipient.name === "Bad"
          ? { deliverability: "undeliverable", suggested: null, changed: false }
          : { deliverability: "deliverable", suggested: null, changed: false },
      ),
    );
    const onBlockedChange = vi.fn();
    renderWithProviders(
      <Recipients recipients={[TYPED, { ...TYPED, name: "Bad", line1: "1 Nowhere Rd" }]} onChange={() => {}} onBlockedChange={onBlockedChange} />,
    );

    expect(await screen.findByText("Verified")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Fix Bad" })).toBeInTheDocument();
    await waitFor(() => expect(onBlockedChange).toHaveBeenLastCalledWith(1));
  });
});
