import { readFileSync } from "node:fs";
import type {
  ListTimezonesResponse,
  TimezoneCatalogEntry,
  TimezoneCatalogGroup,
} from "@nakama/core";
import { getTimezoneCityAliases } from "./timezone-city-aliases";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

const ZONE_TAB_PATHS = [
  "/usr/share/zoneinfo/zone1970.tab",
  "/usr/share/zoneinfo/zone.tab",
];

/** ICU / CLDR names that differ from the current zone.tab id. */
const ZONE_ALIASES: Readonly<Record<string, string>> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

let cachedCatalog: ListTimezonesResponse | null = null;
let cachedCountryByZone: Map<string, string> | null = null;

function cityFromZoneName(zoneName: string): string {
  const parts = zoneName.split("/");
  const city = parts.slice(1).join("/").replace(/_/g, " ");

  return city || zoneName;
}

function formatPart(
  timeZone: string,
  timeZoneName: "short" | "long" | "longOffset"
): string | undefined {
  return new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value;
}

function gmtOffsetName(timeZone: string): string {
  const offset = formatPart(timeZone, "longOffset") ?? "GMT";
  return offset.replace(/^GMT/, "UTC");
}

function isSupportedTimeZone(zoneName: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: zoneName });
    return true;
  } catch {
    return false;
  }
}

function loadCountryByZone(): Map<string, string> {
  if (cachedCountryByZone) {
    return cachedCountryByZone;
  }

  const map = new Map<string, string>();

  for (const tabPath of ZONE_TAB_PATHS) {
    try {
      for (const line of readFileSync(tabPath, "utf8").split(/\r?\n/)) {
        if (!line || line.startsWith("#")) {
          continue;
        }
        const columns = line.split("\t");
        const countryCode = columns[0]?.split(",")[0]?.trim();
        const zoneName = columns[2]?.trim();
        if (countryCode && zoneName) {
          map.set(zoneName, countryCode);
        }
      }
      break;
    } catch {
      // try the next tzdata path
    }
  }

  for (const [alias, canonical] of Object.entries(ZONE_ALIASES)) {
    const countryCode = map.get(alias) ?? map.get(canonical);
    if (countryCode) {
      map.set(alias, countryCode);
      map.set(canonical, countryCode);
    }
  }

  cachedCountryByZone = map;
  return map;
}

function toCatalogEntry(
  zoneName: string,
  countryByZone: Map<string, string>
): TimezoneCatalogEntry {
  const countryCode = countryByZone.get(zoneName) ?? "ZZ";
  const city = cityFromZoneName(zoneName);
  const countryName =
    countryCode === "ZZ"
      ? (zoneName.split("/")[0] ?? zoneName)
      : (countryNames.of(countryCode) ?? countryCode);
  const aliases = getTimezoneCityAliases(zoneName);
  const offset = gmtOffsetName(zoneName);

  return {
    abbreviation: formatPart(zoneName, "short") ?? offset,
    city,
    countryCode,
    countryName,
    id: zoneName,
    label: `${city} · ${offset}`,
    offset,
    tzName: formatPart(zoneName, "long") ?? zoneName,
    ...(aliases.length > 0 ? { aliases } : {}),
  };
}

export async function getTimezoneCatalog(): Promise<ListTimezonesResponse> {
  if (cachedCatalog) {
    return cachedCatalog;
  }

  const countryByZone = loadCountryByZone();
  const groups = new Map<string, TimezoneCatalogGroup>();
  const zoneNames = new Set([
    ...Intl.supportedValuesOf("timeZone"),
    ...countryByZone.keys(),
  ]);

  for (const zoneName of zoneNames) {
    if (!isSupportedTimeZone(zoneName)) {
      continue;
    }

    const entry = toCatalogEntry(zoneName, countryByZone);
    const existing = groups.get(entry.countryCode);

    if (existing) {
      existing.timezones.push(entry);
      continue;
    }

    groups.set(entry.countryCode, {
      countryCode: entry.countryCode,
      countryName: entry.countryName,
      timezones: [entry],
    });
  }

  cachedCatalog = {
    groups: [...groups.values()]
      .map((group) => ({
        ...group,
        timezones: group.timezones.sort((left, right) =>
          left.city.localeCompare(right.city)
        ),
      }))
      .sort((left, right) => left.countryName.localeCompare(right.countryName)),
  };

  return cachedCatalog;
}

export function resetTimezoneCatalogCache(): void {
  cachedCatalog = null;
  cachedCountryByZone = null;
}
