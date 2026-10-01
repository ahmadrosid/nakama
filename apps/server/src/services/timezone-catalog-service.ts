import { readFileSync } from "node:fs";
import type { ListTimezonesResponse, TimezoneCatalogEntry } from "@nakama/core";
import { getTimezoneCityAliases } from "./timezone-city-aliases";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

const ZONE_TAB_PATHS = [
  "/usr/share/zoneinfo/zone1970.tab",
  "/usr/share/zoneinfo/zone.tab",
];

const REGION_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

type LocaleWithTimeZones = Intl.Locale & { getTimeZones?: () => string[] };

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

/** Static zone metadata. Seasonal display fields are not stored here. */
interface CachedCatalogEntry {
  aliases?: string[];
  city: string;
  countryCode: string;
  countryName: string;
  id: string;
}

interface CachedCatalogGroup {
  countryCode: string;
  countryName: string;
  timezones: CachedCatalogEntry[];
}

let cachedCatalog: CachedCatalogGroup[] | null = null;
let cachedCountryByZone: Map<string, string> | null = null;

function cityFromZoneName(zoneName: string): string {
  const parts = zoneName.split("/");
  const city = parts.slice(1).join("/").replace(/_/g, " ");

  return city || zoneName;
}

function formatPart(
  timeZone: string,
  timeZoneName: "short" | "long" | "longOffset",
  instant: Date
): string | undefined {
  return new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value;
}

function gmtOffsetName(timeZone: string, instant: Date): string {
  const offset = formatPart(timeZone, "longOffset", instant) ?? "GMT";
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

/**
 * Windows ships no tzdata tables, but ICU knows the zones of each region. No
 * API lists the regions themselves, so every two-letter code is asked once.
 * ICU answers with CLDR ids, which ZONE_ALIASES then maps to the tzdata ones.
 */
function addCountriesFromIcu(map: Map<string, string>): void {
  for (const first of REGION_LETTERS) {
    for (const second of REGION_LETTERS) {
      const region = `${first}${second}`;
      const locale = new Intl.Locale("und", { region }) as LocaleWithTimeZones;
      for (const zoneName of locale.getTimeZones?.() ?? []) {
        map.set(zoneName, region);
      }
    }
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

  if (map.size === 0 && process.platform === "win32") {
    addCountriesFromIcu(map);
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
): CachedCatalogEntry {
  const countryCode = countryByZone.get(zoneName) ?? "ZZ";
  const city = cityFromZoneName(zoneName);
  const countryName =
    countryCode === "ZZ"
      ? (zoneName.split("/")[0] ?? zoneName)
      : (countryNames.of(countryCode) ?? countryCode);
  const aliases = getTimezoneCityAliases(zoneName);

  return {
    city,
    countryCode,
    countryName,
    id: zoneName,
    ...(aliases.length > 0 ? { aliases } : {}),
  };
}

function withSeasonalFields(
  entry: CachedCatalogEntry,
  instant: Date
): TimezoneCatalogEntry {
  const offset = gmtOffsetName(entry.id, instant);

  return {
    abbreviation: formatPart(entry.id, "short", instant) ?? offset,
    city: entry.city,
    countryCode: entry.countryCode,
    countryName: entry.countryName,
    id: entry.id,
    label: `${entry.city} · ${offset}`,
    offset,
    tzName: formatPart(entry.id, "long", instant) ?? entry.id,
    ...(entry.aliases ? { aliases: [...entry.aliases] } : {}),
  };
}

export async function getTimezoneCatalog(): Promise<ListTimezonesResponse> {
  const instant = new Date();

  if (!cachedCatalog) {
    const countryByZone = loadCountryByZone();
    const groups = new Map<string, CachedCatalogGroup>();
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

    cachedCatalog = [...groups.values()]
      .map((group) => ({
        ...group,
        timezones: group.timezones.sort((left, right) =>
          left.city.localeCompare(right.city)
        ),
      }))
      .sort((left, right) => left.countryName.localeCompare(right.countryName));
  }

  return {
    groups: cachedCatalog.map((group) => ({
      countryCode: group.countryCode,
      countryName: group.countryName,
      timezones: group.timezones.map((entry) =>
        withSeasonalFields(entry, instant)
      ),
    })),
  };
}

export function resetTimezoneCatalogCache(): void {
  cachedCatalog = null;
  cachedCountryByZone = null;
}
