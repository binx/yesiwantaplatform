/**
 * USPS state codes: the fifty states, DC, and the abbreviations Lob accepts
 * for the territories and the military "state" codes (AA/AE/AP route an
 * APO/FPO/DPO address rather than naming a place).
 *
 * Alphabetised by name, since that is how the picker shows them.
 */
export const US_STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AS", name: "American Samoa" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "AA", name: "Armed Forces Americas" },
  { code: "AE", name: "Armed Forces Europe" },
  { code: "AP", name: "Armed Forces Pacific" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "GU", name: "Guam" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "MP", name: "Northern Mariana Islands" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "PR", name: "Puerto Rico" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "VI", name: "U.S. Virgin Islands" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

export const US_STATE_CODES: ReadonlySet<string> = new Set(US_STATES.map((state) => state.code));

/** The state's own name for its code, case-insensitively — "california" and "CA" both find it. */
const namesByLower = new Map(US_STATES.map((state) => [state.name.toLowerCase(), state.code]));

/** "California" → "CA"; a code or an unmatched name is returned unchanged (uppercased if it already looks like a code). */
export function usStateCode(value: string): string {
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  if (US_STATE_CODES.has(upper)) return upper;
  return namesByLower.get(trimmed.toLowerCase()) ?? trimmed;
}
