# Anti-slop source record

Installed from the local `install-anti-slop` skill bundle on 2026-10-08.
Source path: `/Users/ahmadrosid/.codex/skills/install-anti-slop/assets/anti-slop/`.
Source repository and exact source commit: unknown; the bundle supplies neither.
The copied files match the bundle byte for byte. SHA-256 checksums below identify
these bytes; they do not provide a recoverable upstream base.

Installed entry points:
- Generic: `tools/oxlint/anti-slop/index.ts` (enabled).
- Effect: `tools/oxlint/anti-slop/effect/index.ts` (copied, not enabled).

No plugin source deviations. Local configuration enables all 18 generic rules
and `oxc/no-accumulating-spread` as errors. Biome retains its existing checks;
Oxlint's default correctness category is disabled to avoid a second unrelated
lint policy. No direct `effect` dependency exists in the package manifests.

The bundled Stylistic source retains its license and its own
`vendor/eslint-stylistic/UPSTREAM.md` with the verified upstream revision.

## Pristine bundle checksums

```text
da7851d2c89a66b31ece6a36e88a78065d12dff6f92676d119981574bcd3669f  effect/index.ts
41434abb14bdb73760a2dfa4121b9e037f3ca741b0530c4f04d36f3a9e1041fd  effect/rules/no-manual-effect-error-tag.ts
f1e7c36b878f872b3cd4482e751bede505aafc21dabf93353a16e1c305bdb0bb  effect/rules/no-manual-tag-comparison.ts
fc264fcbd8b2809f458ac11fd33f242ccc9cfbc4b605cee85ce490c9dd1d8f44  effect/rules/no-manual-tagged-construction.ts
c397d1132329fbe82213dda80059c86acb99f0fe243e59615f615a86069c6fb1  effect/rules/no-service-constructor-imports.ts
94309ecd136d12b6b5424fccb6fde222adb1c2c278fb8f198c4c115febbfa69c  effect/rules/prefer-effect-match.ts
91e65bc7ebba81eda53c049fb3a07e03982a20476546cb9b4f3cbe2e66297d1c  effect/shared/tagged-values.ts
9deed4cb455b9a6251001dc3a525d5b5e2c6ef989dd1c01e804c2edf0a697415  index.ts
528bba857b84712c038e35e59079cc1e6c78a0421c65bb3c6117c9d412a2f28a  rules/no-array-filter-map.ts
72f8e981520f94adac0ffbdab8f8e84e5f2a4595f14e4a6471be917a85a20a15  rules/no-chained-type-assertions.ts
33f044030d208fcc10be73bb19c8172c275c5229df4b0ca8ec10f069bbe60062  rules/no-conditional-empty-object-spread.ts
321944d20912acc93f65f4b84075916202adfda6b8eaa839d96f0d8b8ec1463b  rules/no-known-value-widening.ts
e29ba7d9ba4a5aed971002840bf434beef93393f60a589e55b72c203dde4c8db  rules/no-module-mocking.ts
2056e99dcb228604d9b2534952045e8ebf9f90af54add67d07a1211657d32941  rules/no-object-parameters.ts
dce4b08ee7ac4bbedfe743f6fa4a3d423cde50b37691130b899cc4573c05d2ae  rules/no-reduce-accumulator-copy.ts
f7920a332106252d6a24cdc917a2c1a433eb438792996ccceb5a25cd6e591dbb  rules/no-reflect-apply.ts
95c5aa0f8e23b10d9345b1776082e08704ec6590298176a8ede8dfdb6e7cb56f  rules/no-reflect-get.ts
c3ff29662f9f5a0cbad527b200aadd486cbe63ee0d9bbf10c409ce9c39ec678c  rules/no-runtime-typeof.ts
4e5edcb5ed083de77970a2e4f64e4b2090ba6c4588e9fc6bcb1f01900ae905b7  rules/no-shape-in-symbol-names.ts
81df45f83b1bca1bbf0bbc36e9211e10cad1aa2bb0ab604840ed9f1b94eaa2e5  rules/no-unknown-parameters.ts
67f3ac72d9f98ce29426e70be1e0c359599d94b5799f1130b7ec4cc34129f26b  rules/no-unknown-returns.ts
e34000ccdd5c496fadb1418e29b44a1df970ebc9075e89ef2412f7029ec4c15b  rules/no-unknown-type-aliases.ts
6ff0b3aafe00bc42300080c514ddbee54a45508d5781cab2fb78156a19756a71  rules/no-unsafe-dictionary-type.ts
63f2c07cc42b8ad60a7e868efbd7b29e462b9ba960fbd07bbc8f590ef9e3f879  rules/no-widen-then-assert.ts
e63084ad77e215ad25e963c452d8ee819fb1cac3aefe3401e169985a145ac4bc  rules/require-readable-spacing.ts
c8ed9f50f1c6e3592b77165dd8847d187ee9b0ef955d50f8099498d3139aa27c  rules/require-safety-comment-for-type-assertion.ts
e360557253c56ab7c256623f3338415743e5027e9d999f801fb79d98240d217b  shared/array-method.ts
0f319a2d2cb34c7b3902fb78301c91e1a750bd663c754e73d669f31dc5026525  shared/dictionary-types.ts
ad80a650ea14847736ab9ee4c872dc89cc7d527bf60e7de20112bcb8f679545c  shared/function-parameters.ts
1ae0aa3ec245f1dc43c4bbbd8be1e2e4230e5dc389d1ca4e8de8f51b62ceff29  shared/lexical-type-parameters.ts
d1b7bd13ca714bf20bec15e835ed0526316b7274e06bd9a582cf623c09ac1d40  shared/reflect-method.ts
e38d41eeada854dbd02285e84e065d10e69460695e06e53fbe8662c963ae7eb4  shared/scope.ts
5520e97b177f0093af2943808ac63cef0f6c03fedd197a36137c66209d78a8e0  shared/type-alias-resolution.ts
a429d52d537b871facb01c086191ec8a56a22bf1a10f4e641daff114bccc4a74  vendor/eslint-stylistic/LICENSE
7080b0f37202f02f44630e7e13182643561a998b328e8044efe89d3f7d6fca74  vendor/eslint-stylistic/UPSTREAM.md
ae3624502620452022691c89a30ed95d669dc961a5802dbe27c44e45a647c3d0  vendor/eslint-stylistic/padding-line-ast.ts
6974d23a3d2769bfcd5211f1c1fb29c966be122dd37e764c2cf84c5f639a380d  vendor/eslint-stylistic/padding-line-between-statements.ts
ff3d52f2b1c103bc429e030976641715caec676af4b8a0be802c0009874a0d58  vendor/eslint-stylistic/padding-line-options.d.ts
```
