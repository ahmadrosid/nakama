import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

/**
 * SHA-256 of the upstream sources copied verbatim from moodstone 1.0.1
 * (`karacca/moodstone` commit `5d3d2568b0b75f412744d00ee4eb0e70d1a972f2`).
 * A mismatch means the vendored copy drifted; re-copy the file rather than edit
 * it, or refresh every hash together with the README when bumping upstream.
 */
const UPSTREAM_SHA256 = {
  "core/box.ts":
    "e211e16414a091c9a262c7673e1c7bfe73e3656d2bf4329f7371d085ddd9447e",
  "core/color.ts":
    "7570ef642027d853e39756e50503cfca69af0e1887731787787dc5ecc278da27",
  "core/frame.ts":
    "d60e26dc725d917d80b19b7669ab13be7ba5c36b8f0a27ef262e32942bbe1f90",
  "core/geometry.ts":
    "ac1dcea06d32f226d606d4c93c294363bfd1120cb1ff603c870a45a427264a94",
  "core/index.ts":
    "ce454233ad40ea3fc6ed465e23dcabe43aff7b4d9dad391aa2b346c2f3614d76",
  "core/math.ts":
    "4c34d29c5134396fdc64abb575be1b3e096160041015bbee052281dbf4987da7",
  "core/moods.ts":
    "e84e56f0db4a949c1dbd3c3c5979ac2d146b7c2e58b9b8c40155fda723adcb75",
  "core/palette.ts":
    "78d44eb39d178a4bf8e515b3e382e377e86b4f42a8f1b1d28460cecb0f255874",
  "core/seed.ts":
    "3f08226e7802225b43d86396e3f1c4d0c22344480c9109fdaca14a7c0fae29bd",
  "core/shape.ts":
    "b897d548a7e454b96fa300c0c05671055057576ca183db7916443cd7cdde094e",
  "core/types.ts":
    "bcf9bb975e9cce4629381312a55402d2cf8ebd0a5400af0e2f2c93b1031a640f",
  "svg.ts": "7fc9cd94b6474f7efe608f85d82af7455d4fc0c116f90a14528bb1ade9fb3202",
};

function sha256(file: string): string {
  return createHash("sha256")
    .update(readFileSync(new URL(file, import.meta.url)))
    .digest("hex");
}

describe("vendored moodstone sources", () => {
  test("match the pinned upstream release", () => {
    for (const [file, hash] of Object.entries(UPSTREAM_SHA256)) {
      expect({ file, hash: sha256(file) }).toEqual({ file, hash });
    }
  });

  test("ship no unlisted files", () => {
    const copied = readdirSync(new URL("./core", import.meta.url)).sort();

    expect(copied).toEqual(
      Object.keys(UPSTREAM_SHA256)
        .filter((file) => file.startsWith("core/"))
        .map((file) => file.slice("core/".length))
        .sort()
    );
  });
});
