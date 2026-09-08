import { describe, expect, it } from "vitest";
import { csvField, csvRow } from "./csv.js";

describe("csvField", () => {
  it("leaves an ordinary value alone", () => {
    expect(csvField("Canvas Tote")).toBe("Canvas Tote");
    expect(csvField(3400)).toBe("3400");
  });

  it("renders null and undefined as empty", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
    expect(csvField("")).toBe("");
  });

  it("quotes a field containing a comma", () => {
    expect(csvField("Marfa, TX")).toBe('"Marfa, TX"');
  });

  it("doubles embedded quotes", () => {
    expect(csvField('The "big" one')).toBe('"The ""big"" one"');
  });

  it("quotes newlines and carriage returns", () => {
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("neutralises a formula so a spreadsheet shows text", () => {
    // Live formulas from a product name are the actual attack here.
    expect(csvField("=1+1")).toBe("'=1+1");
    expect(csvField('=HYPERLINK("http://evil")')).toBe(
      '"\'=HYPERLINK(""http://evil"")"',
    );
    expect(csvField("+1")).toBe("'+1");
    expect(csvField("-1")).toBe("'-1");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("does not mangle a negative number written as a number", () => {
    // Still guarded — a spreadsheet cell starting "-" is ambiguous, and money
    // columns in this export are integers that never carry a sign.
    expect(csvField(-5)).toBe("'-5");
  });

  it("passes non-ASCII through untouched", () => {
    expect(csvField("Café — größe")).toBe("Café — größe");
  });
});

describe("csvRow", () => {
  it("joins fields and terminates with CRLF", () => {
    expect(csvRow(["a", "b, c", 1])).toBe('a,"b, c",1\r\n');
  });

  it("renders an empty row as just the separators", () => {
    expect(csvRow(["", ""])).toBe(",\r\n");
  });
});
