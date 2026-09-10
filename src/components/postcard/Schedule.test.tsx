import { describe, expect, it, vi } from "vitest";
import { addDaysIso, todayIso, type PostcardDesign } from "@shared/postcards";
import { fireEvent, renderWithProviders, screen, userEvent } from "@/test-utils";
import { Schedule } from "./Schedule";

/**
 * The schedule's two modes: a cadence, or a date under each design.
 */
const design = (id: string): PostcardDesign => ({
  id,
  orientation: "portrait",
  thumbnail: { path: `designs/${id}/thumb.webp`, width: 408, height: 600, alt: "", widths: [] },
  back: { text: "", valediction: "", fontName: "Patrick Hand", fontSize: 24, fontColor: "#000000" },
  createdAt: 0,
});

const today = todayIso();
const items = [
  { design: design("a"), mailDate: today },
  { design: design("b"), mailDate: addDaysIso(today, 7) },
];

function renderSchedule(mode: "cadence" | "custom", handlers: Partial<Parameters<typeof Schedule>[0]> = {}) {
  const onDateChange = vi.fn();
  const onModeChange = vi.fn();
  const onArriveBy = vi.fn();
  const onReplyLinkChange = vi.fn();
  renderWithProviders(
    <Schedule
      items={items}
      mode={mode}
      startDate={today}
      cadenceDays={7}
      replyLink
      onReplyLinkChange={onReplyLinkChange}
      onModeChange={onModeChange}
      onStartDateChange={() => {}}
      onCadenceChange={() => {}}
      onDateChange={onDateChange}
      onArriveBy={onArriveBy}
      onRemove={() => {}}
      locale="en-US"
      {...handlers}
    />,
  );
  return { onDateChange, onModeChange, onArriveBy, onReplyLinkChange };
}

describe("Schedule", () => {
  it("offers the toggle with two designs and shows the cadence controls by default", () => {
    renderSchedule("cadence");
    expect(screen.getByText("Pick each date")).toBeInTheDocument();
    expect(screen.getByLabelText("Mail the first one on")).toBeInTheDocument();
    expect(screen.queryByLabelText("Mail date for design 1")).not.toBeInTheDocument();
  });

  it("shows one date input per design in custom mode and reports which design changed", () => {
    const { onDateChange } = renderSchedule("custom");
    expect(screen.queryByLabelText("Mail the first one on")).not.toBeInTheDocument();

    const second = screen.getByLabelText("Mail date for design 2");
    expect(second).toHaveValue(addDaysIso(today, 7));

    // A date input takes a whole value or nothing, so this is a change event rather than keystrokes.
    const target = addDaysIso(today, 30);
    fireEvent.change(second, { target: { value: target } });
    expect(onDateChange).toHaveBeenLastCalledWith("b", target);
  });

  it("switches mode through the toggle", async () => {
    const { onModeChange } = renderSchedule("cadence");
    await userEvent.click(screen.getByText("Pick each date"));
    expect(onModeChange).toHaveBeenCalledWith("custom");
  });

  it("mails a chosen number of days ahead of the day that matters, promising nothing about arrival", async () => {
    const { onArriveBy } = renderSchedule("custom");
    await userEvent.click(screen.getByRole("button", { name: "Send it ahead of a date" }));

    const target = "2099-06-15";
    const input = await screen.findByLabelText("The day that matters");
    fireEvent.change(input, { target: { value: target } });
    // A week ahead by default, in calendar days; the note says how long it takes is not ours to promise.
    expect(await screen.findByText(/Mails Jun 8, 2099/)).toBeInTheDocument();
    expect(screen.getByText(/depends on how far it travels/)).toBeInTheDocument();
    expect(screen.queryByText(/should arrive/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Use this date" }));
    expect(onArriveBy).toHaveBeenCalledWith("a", "2099-06-08");
  });

  it("offers the QR code on the back, on by default, and reports it being turned off", async () => {
    const { onReplyLinkChange } = renderSchedule("cadence");
    const box = screen.getByRole("checkbox", { name: /Print a small QR code/ });
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(onReplyLinkChange).toHaveBeenCalledWith(false);
  });
});
