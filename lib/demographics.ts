// Option lists for subscriber demographics. Kept in one place so the
// welcome page, the /settings card, and the future /admin/audience
// breakdown all reference the same values. Storage shape is documented
// in supabase/migrations/0046_subscriber_demographics.sql.

export const AGE_BANDS = [
  { value: "18-24",             label: "18 – 24" },
  { value: "25-34",             label: "25 – 34" },
  { value: "35-44",             label: "35 – 44" },
  { value: "45-54",             label: "45 – 54" },
  { value: "55-64",             label: "55 – 64" },
  { value: "65+",               label: "65 or older" },
  { value: "prefer-not-to-say", label: "Prefer not to say" },
] as const;

export const INCOME_BANDS = [
  { value: "<50k",              label: "Under $50,000" },
  { value: "50k-100k",          label: "$50,000 – $100,000" },
  { value: "100k-150k",         label: "$100,000 – $150,000" },
  { value: "150k-250k",         label: "$150,000 – $250,000" },
  { value: "250k+",             label: "$250,000 or more" },
  { value: "prefer-not-to-say", label: "Prefer not to say" },
] as const;

export const GENDERS = [
  { value: "man",               label: "Man" },
  { value: "woman",             label: "Woman" },
  { value: "non-binary",        label: "Non-binary" },
  { value: "prefer-not-to-say", label: "Prefer not to say" },
] as const;

// Country list is short on purpose — covers ~99% of boxscore subs
// based on signup IPs. "Other" stays in until we see signups from
// places we'd want to break out (Latin America, Asia-Pacific) in the
// advertiser dashboard.
export const COUNTRIES = [
  { value: "US", label: "United States" },
  { value: "CA", label: "Canada" },
  { value: "GB", label: "United Kingdom" },
  { value: "MX", label: "Mexico" },
  { value: "AU", label: "Australia" },
  { value: "JP", label: "Japan" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "Other", label: "Other / Prefer not to say" },
] as const;

// US states + DC + territories. Surfaced as a dropdown only when
// country=US — for non-US subscribers we currently don't break down
// the audience by region (Canadian provinces, Bundesländer, etc.).
// If we ever want CA / GB / AU regions, add parallel lists and switch
// the picker on `country`.
export const US_STATES = [
  { value: "AL", label: "Alabama" },
  { value: "AK", label: "Alaska" },
  { value: "AZ", label: "Arizona" },
  { value: "AR", label: "Arkansas" },
  { value: "CA", label: "California" },
  { value: "CO", label: "Colorado" },
  { value: "CT", label: "Connecticut" },
  { value: "DE", label: "Delaware" },
  { value: "DC", label: "District of Columbia" },
  { value: "FL", label: "Florida" },
  { value: "GA", label: "Georgia" },
  { value: "HI", label: "Hawaii" },
  { value: "ID", label: "Idaho" },
  { value: "IL", label: "Illinois" },
  { value: "IN", label: "Indiana" },
  { value: "IA", label: "Iowa" },
  { value: "KS", label: "Kansas" },
  { value: "KY", label: "Kentucky" },
  { value: "LA", label: "Louisiana" },
  { value: "ME", label: "Maine" },
  { value: "MD", label: "Maryland" },
  { value: "MA", label: "Massachusetts" },
  { value: "MI", label: "Michigan" },
  { value: "MN", label: "Minnesota" },
  { value: "MS", label: "Mississippi" },
  { value: "MO", label: "Missouri" },
  { value: "MT", label: "Montana" },
  { value: "NE", label: "Nebraska" },
  { value: "NV", label: "Nevada" },
  { value: "NH", label: "New Hampshire" },
  { value: "NJ", label: "New Jersey" },
  { value: "NM", label: "New Mexico" },
  { value: "NY", label: "New York" },
  { value: "NC", label: "North Carolina" },
  { value: "ND", label: "North Dakota" },
  { value: "OH", label: "Ohio" },
  { value: "OK", label: "Oklahoma" },
  { value: "OR", label: "Oregon" },
  { value: "PA", label: "Pennsylvania" },
  { value: "PR", label: "Puerto Rico" },
  { value: "RI", label: "Rhode Island" },
  { value: "SC", label: "South Carolina" },
  { value: "SD", label: "South Dakota" },
  { value: "TN", label: "Tennessee" },
  { value: "TX", label: "Texas" },
  { value: "UT", label: "Utah" },
  { value: "VT", label: "Vermont" },
  { value: "VA", label: "Virginia" },
  { value: "WA", label: "Washington" },
  { value: "WV", label: "West Virginia" },
  { value: "WI", label: "Wisconsin" },
  { value: "WY", label: "Wyoming" },
] as const;

const AGE_SET     = new Set(AGE_BANDS.map((o) => o.value));
const INCOME_SET  = new Set(INCOME_BANDS.map((o) => o.value));
const GENDER_SET  = new Set(GENDERS.map((o) => o.value));
const COUNTRY_SET = new Set(COUNTRIES.map((o) => o.value));
const US_STATE_SET = new Set(US_STATES.map((o) => o.value));

export type DemographicsInput = {
  country?:     string | null;
  region?:      string | null;
  age_band?:    string | null;
  income_band?: string | null;
  gender?:      string | null;
};

// Coerce form input to a safe payload for the subscribers row update.
// Empty strings become null. Unknown enum values become null so a
// crafted form post can't write garbage into the column.
export function sanitizeDemographics(input: DemographicsInput): DemographicsInput {
  const cleanEnum = (v: string | null | undefined, set: Set<string>): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (!t) return null;
    return set.has(t) ? t : null;
  };
  const cleanText = (v: string | null | undefined, max: number): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (!t) return null;
    return t.slice(0, max);
  };
  const country = cleanEnum(input.country, COUNTRY_SET);
  // Region is only meaningful for US right now. For non-US selections
  // we drop the region value so a stranded "OH" doesn't survive on a
  // subscriber who later changes their country to Canada.
  const region = country === "US"
    ? cleanEnum(input.region, US_STATE_SET)
    : null;
  return {
    country,
    region,
    age_band:    cleanEnum(input.age_band, AGE_SET),
    income_band: cleanEnum(input.income_band, INCOME_SET),
    gender:      cleanEnum(input.gender, GENDER_SET),
  };
}
