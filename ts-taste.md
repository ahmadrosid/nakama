# TypeScript Taste

- Avoid `as unknown as T` — fix the type, narrow, or parse at the boundary.
- Prefer SDK types and discriminated unions over `Record<string, unknown>`.
- Single `as T` OK for real interop; double casts OK only in test mocks.
