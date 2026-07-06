import { getTimezones } from "@countrystatecity/timezones";
import type {
  ListTimezonesResponse,
  TimezoneCatalogEntry,
  TimezoneCatalogGroup,
} from "@nakama/core";
import { getTimezoneCityAliases } from "./timezone-city-aliases";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

let cachedCatalog: ListTimezonesResponse | null = null;

function cityFromZoneName(zoneName: string): string {
  const parts = zoneName.split("/");
  const city = parts.slice(1).join("/").replace(/_/g, " ");

  return city || zoneName;
}

function toCatalogEntry(timezone: {
  zoneName: string;
  countryCode: string;
  abbreviation: string;
  gmtOffsetName: string;
  tzName: string;
}): TimezoneCatalogEntry {
  const city = cityFromZoneName(timezone.zoneName);
  const countryName = countryNames.of(timezone.countryCode) ?? timezone.countryCode;
  const aliases = getTimezoneCityAliases(timezone.zoneName);

  return {
    id: timezone.zoneName,
    countryCode: timezone.countryCode,
    countryName,
    city,
    label: `${city} · ${timezone.gmtOffsetName}`,
    offset: timezone.gmtOffsetName,
    abbreviation: timezone.abbreviation,
    tzName: timezone.tzName,
    ...(aliases.length > 0 ? { aliases } : {}),
  };
}

export async function getTimezoneCatalog(): Promise<ListTimezonesResponse> {
  if (cachedCatalog) {
    return cachedCatalog;
  }

  const rawTimezones = await getTimezones();
  const groups = new Map<string, TimezoneCatalogGroup>();

  for (const timezone of rawTimezones) {
    const entry = toCatalogEntry(timezone);
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
        timezones: group.timezones.sort((left, right) => left.city.localeCompare(right.city)),
      }))
      .sort((left, right) => left.countryName.localeCompare(right.countryName)),
  };

  return cachedCatalog;
}

export function resetTimezoneCatalogCache(): void {
  cachedCatalog = null;
}
