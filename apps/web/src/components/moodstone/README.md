# Moodstone (vendored)

Pure-SVG parts of [Moodstone](https://github.com/karacca/moodstone), an
MIT-licensed procedural avatar renderer. Profiles get a stable cut and palette
from their id; the animated face changes with the agent's activity.

Vendored from `karacca/moodstone` at commit
`5d3d2568b0b75f412744d00ee4eb0e70d1a972f2` (v1.0.1):

- `core/` — geometry, moods, colors, and frame sampling. Verbatim.
- `svg.ts` — the static and animated SVG serializers. Verbatim.

Only the browser-safe modules are copied. The React Native entry, Skia
renderer, and Reanimated worklets are not used.

Generating at runtime replaced `moodstone-avatars.ts`, which carried 407 KB of
pre-rendered idle SVGs. The other eight moods would have added roughly 3 MB.
Frame sampling costs 0.5–3 ms per animated loop; `moodstoneSvg` caches the last
24 loops, so a repeat mood is a map lookup.

`core/` and `svg.ts` are excluded from the style checks because the upstream
formatting does not match this repo. TypeScript and knip still check them.
`vendored.test.ts` pins the SHA-256 of every copied file to the release above
and fails on any in-place edit, so the copy stays comparable with upstream.

To bump: copy the new sources, update the commit above and the hashes in
`vendored.test.ts`, then compare the generated stills and loops with the old
output before shipping.

MIT license: see [LICENSE](./LICENSE).
