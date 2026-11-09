import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

export const DEFAULT_COUNTRY: CountryCode = 'IT';

/** E.164 form (`+390957124483`) or null when the input is not a plausible number. */
export function toE164(value: string, country: CountryCode = DEFAULT_COUNTRY): string | null {
  const parsed = parsePhoneNumberFromString(value, country);
  if (!parsed || !parsed.isPossible()) return null;
  return parsed.number;
}

/** International display form (`+39 095 712 4483`); falls back to the trimmed input. */
export function formatPhone(value: string, country: CountryCode = DEFAULT_COUNTRY): string {
  const parsed = parsePhoneNumberFromString(value, country);
  return parsed && parsed.isPossible() ? parsed.formatInternational() : value.trim();
}

export function isMobile(value: string, country: CountryCode = DEFAULT_COUNTRY): boolean {
  const parsed = parsePhoneNumberFromString(value, country);
  return parsed?.getType() === 'MOBILE';
}
