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

function loadCountryByZone(): Map<string, string> {
  if (cachedCountryByZone) {
    return cachedCountryByZone;
  }

  const map = new Map<string, string>();

  for (const tabPath of ZONE_TAB_PATHS) {
    try {
      const raw = readFileSync(tabPath, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        if (!line || line.startsWith("#")) {
          continue;
        }
        const columns = line.split("\t");
        const countries = columns[0]?.split(",")[0]?.trim();
        const zoneName = columns[2]?.trim();
        if (countries && zoneName) {
          map.set(zoneName, countries);
        }
      }
      break;
    } catch {
      // try the next tzdata path
    }
  }

  cachedCountryByZone = map;
  return map;
}

function toCatalogEntry(zoneName: string): TimezoneCatalogEntry {
  const countryByZone = loadCountryByZone();
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

  const groups = new Map<string, TimezoneCatalogGroup>();

  for (const zoneName of Intl.supportedValuesOf("timeZone")) {
    const entry = toCatalogEntry(zoneName);
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
