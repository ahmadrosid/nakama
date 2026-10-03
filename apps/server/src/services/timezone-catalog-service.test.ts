import { afterEach, expect, setSystemTime, test } from "bun:test";
import {
  getTimezoneCatalog,
  resetTimezoneCatalogCache,
} from "./timezone-catalog-service";

afterEach(() => {
  setSystemTime();
  resetTimezoneCatalogCache();
});

test("groups IANA zones by tzdata country", async () => {
  const catalog = await getTimezoneCatalog();
  const unitedStates = catalog.groups.find(
    (group) => group.countryCode === "US"
  );
  const ids = new Set(unitedStates?.timezones.map((zone) => zone.id));
  const newYork = unitedStates?.timezones.find(
    (zone) => zone.id === "America/New_York"
  );

  expect(unitedStates?.countryName).toBe("United States");
  expect(newYork?.city).toBe("New York");
  expect(newYork?.offset.startsWith("UTC")).toBe(true);
  expect(newYork?.aliases).toContain("NYC");
  expect(ids.has("America/Indiana/Indianapolis")).toBe(true);
  expect(ids.has("America/Kentucky/Louisville")).toBe(true);
});

const seasonalTransitions = [
  {
    first: {
      abbreviation: "EST",
      offset: "UTC-05:00",
      tzName: "Eastern Standard Time",
    },
    firstInstant: "2026-03-08T06:59:59Z",
    name: "spring forward",
    second: {
      abbreviation: "EDT",
      offset: "UTC-04:00",
      tzName: "Eastern Daylight Time",
    },
    secondInstant: "2026-03-08T07:00:00Z",
  },
  {
    first: {
      abbreviation: "EDT",
      offset: "UTC-04:00",
      tzName: "Eastern Daylight Time",
    },
    firstInstant: "2026-11-01T05:59:59Z",
    name: "fall back",
    second: {
      abbreviation: "EST",
      offset: "UTC-05:00",
      tzName: "Eastern Standard Time",
    },
    secondInstant: "2026-11-01T06:00:00Z",
  },
  {
    first: {
      abbreviation: "EDT",
      offset: "UTC-04:00",
      tzName: "Eastern Daylight Time",
    },
    firstInstant: "2026-07-01T12:00:00Z",
    name: "backward jump to the earlier season",
    second: {
      abbreviation: "EST",
      offset: "UTC-05:00",
      tzName: "Eastern Standard Time",
    },
    secondInstant: "2026-01-15T12:00:00Z",
  },
] as const;

test.each(seasonalTransitions)(
  "refreshes New York seasonal fields on $name",
  async ({ firstInstant, secondInstant, first, second }) => {
    setSystemTime(new Date(firstInstant));
    const firstResponse = await getTimezoneCatalog();
    const firstNewYork = timezoneById(firstResponse, "America/New_York");
    const retainedResponse = structuredClone(firstResponse);

    expectNewYorkSeason(firstResponse, first);

    setSystemTime(new Date(secondInstant));
    const secondResponse = await getTimezoneCatalog();

    expectNewYorkSeason(secondResponse, second);
    expect(firstResponse).toEqual(retainedResponse);
    expect(timezoneById(secondResponse, "America/New_York")).not.toBe(
      firstNewYork
    );
  }
);

function timezoneById(
  catalog: Awaited<ReturnType<typeof getTimezoneCatalog>>,
  id: string
) {
  for (const group of catalog.groups) {
    const timezone = group.timezones.find((entry) => entry.id === id);

    if (timezone) {
      return timezone;
    }
  }

  throw new Error(`missing timezone ${id}`);
}

function expectNewYorkSeason(
  catalog: Awaited<ReturnType<typeof getTimezoneCatalog>>,
  season: { abbreviation: string; offset: string; tzName: string }
) {
  const newYork = timezoneById(catalog, "America/New_York");

  expect(newYork).toMatchObject({
    abbreviation: season.abbreviation,
    city: "New York",
    countryCode: "US",
    countryName: "United States",
    id: "America/New_York",
    label: `New York · ${season.offset}`,
    offset: season.offset,
    tzName: season.tzName,
  });
  expect(newYork.aliases).toContain("NYC");
  expect(timezoneById(catalog, "Asia/Kolkata").offset).toBe("UTC+05:30");
}
