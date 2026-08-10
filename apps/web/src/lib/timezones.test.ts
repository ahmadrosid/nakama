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
          abbreviation: "PST",
          aliases: ["San Francisco", "Seattle"],
          city: "Los Angeles",
          countryCode: "US",
          countryName: "United States",
          id: "America/Los_Angeles",
          label: "Los Angeles · UTC-08:00",
          offset: "UTC-08:00",
          tzName: "Pacific Standard Time",
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
