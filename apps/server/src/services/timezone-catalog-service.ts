import * as fs from "node:fs";
import type {
  ListTimezonesResponse,
  TimezoneCatalogEntry,
  TimezoneCatalogGroup,
} from "@nakama/core";
import { getTimezoneCityAliases } from "./timezone-city-aliases";
import {
  FALLBACK_ZONE_TAB,
  ICU_TIMEZONE_ALIASES,
} from "./timezone-iana-countries";

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

function parseZoneTab(raw: string): Map<string, string> {
  const map = new Map<string, string>();

  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) {
      continue;
    }
    const columns = line.split("\t");
    const countryCode =
      columns.length >= 3
        ? columns[0]?.split(",")[0]?.trim()
        : columns[0]?.trim();
    const zoneName =
      columns.length >= 3 ? columns[2]?.trim() : columns[1]?.trim();
    if (countryCode && zoneName) {
      map.set(zoneName, countryCode);
    }
  }

  return map;
}

function applyIcuAliases(map: Map<string, string>): void {
  for (const [alias, canonical] of Object.entries(ICU_TIMEZONE_ALIASES)) {
    const countryCode = map.get(alias) ?? map.get(canonical);
    if (countryCode) {
      map.set(alias, countryCode);
      map.set(canonical, countryCode);
    }
  }
}

function loadCountryByZone(): Map<string, string> {
  if (cachedCountryByZone) {
    return cachedCountryByZone;
  }

  let map = new Map<string, string>();

  for (const tabPath of ZONE_TAB_PATHS) {
    try {
      map = parseZoneTab(fs.readFileSync(tabPath, "utf8"));
      if (map.size > 0) {
        break;
      }
    } catch {
      // try the next tzdata path, then the bundled fallback
    }
  }

  if (map.size === 0) {
    map = parseZoneTab(FALLBACK_ZONE_TAB);
  }

  applyIcuAliases(map);
  cachedCountryByZone = map;
  return map;
}

function listZoneNames(countryByZone: Map<string, string>): string[] {
  return [
    ...new Set([
      ...Intl.supportedValuesOf("timeZone"),
      ...countryByZone.keys(),
    ]),
  ];
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

  for (const zoneName of listZoneNames(countryByZone)) {
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
