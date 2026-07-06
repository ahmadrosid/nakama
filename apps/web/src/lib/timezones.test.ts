import { describe, expect, test } from "bun:test";
import type { ListTimezonesResponse } from "@nakama/core/contract";
import { searchTimezoneEntries } from "./timezones";

const sampleCatalog: ListTimezonesResponse = {
  groups: [
    {
      countryCode: "US",
      countryName: "United States",
      timezones: [
        {
          id: "America/Los_Angeles",
          countryCode: "US",
          countryName: "United States",
          city: "Los Angeles",
          label: "Los Angeles · UTC-08:00",
          offset: "UTC-08:00",
          abbreviation: "PST",
          tzName: "Pacific Standard Time",
          aliases: ["San Francisco", "Seattle"],
        },
      ],
    },
  ],
};

describe("searchTimezoneEntries", () => {
  test("matches alias cities such as San Francisco", () => {
    const matches = searchTimezoneEntries("San Francisco", sampleCatalog);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe("America/Los_Angeles");
  });

  test("matches when query tokens appear in different fields", () => {
    const matches = searchTimezoneEntries("san francisco", sampleCatalog);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe("America/Los_Angeles");
  });
});
