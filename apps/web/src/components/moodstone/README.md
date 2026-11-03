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
Frame sampling costs 0.5–3 ms per animated loop, once per mood change.

Keep `core/` and `svg.ts` verbatim when updating so the output stays comparable
with upstream. Add the source commit here when you bump them.

MIT license: see [LICENSE](./LICENSE).
