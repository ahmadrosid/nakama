/**
 * Common city names that share an IANA zone with a different canonical city.
 * Keys are IANA zone IDs from @countrystatecity/timezones.
 */
export const TIMEZONE_CITY_ALIASES: Readonly<
  Record<string, readonly string[]>
> = {
  "America/Chicago": [
    "Dallas",
    "Houston",
    "Austin",
    "Minneapolis",
    "New Orleans",
    "Kansas City",
  ],
  "America/Denver": ["Salt Lake City", "Albuquerque", "Boise"],
  "America/Los_Angeles": [
    "San Francisco",
    "Bay Area",
    "Silicon Valley",
    "Seattle",
    "Portland",
    "Las Vegas",
    "San Diego",
    "Sacramento",
    "Oakland",
  ],
  "America/New_York": [
    "New York City",
    "NYC",
    "Boston",
    "Philadelphia",
    "Washington DC",
    "Miami",
    "Atlanta",
    "Detroit",
  ],
  "America/Phoenix": ["Scottsdale", "Tucson"],
  "America/Toronto": ["Ottawa", "Montreal"],
  "Asia/Dubai": ["Abu Dhabi"],
  "Australia/Sydney": ["Melbourne", "Canberra"],
  "Europe/London": ["Manchester", "Birmingham", "Edinburgh", "Dublin"],
  "Europe/Paris": ["Brussels", "Amsterdam"],
};

export function getTimezoneCityAliases(zoneName: string): string[] {
  return [...(TIMEZONE_CITY_ALIASES[zoneName] ?? [])];
}
