# Harness style guide

Conventions inherited from opencode. Apply consistently across `apps/*` and `packages/*`.

## General

- Inline over extract: do not pull single-use helpers out preemptively.
- Avoid `try`/`catch`. Use Effect error channels or early returns.
- Avoid `any`. Rely on type inference; explicit annotations only at exports or unclear boundaries.
- Use Bun APIs (`Bun.file`, `Bun.serve`, `Bun.spawn`) when available.
- Prefer functional array methods (`flatMap`, `filter`, `map`) over `for` loops.
- Reduce variable count by inlining single-use values.

## Control flow

- Prefer `const`. No `let` reassignment when a ternary or early return works.
- No `else`. Use early returns.
- Use dot notation, not destructuring, unless you actually need the names.

## Schemas

- `effect/Schema` for internal parsing of untrusted JSON.
- `zod` at HTTP boundaries (`@hono/zod-validator`) and AI SDK tool parameters.
- Translate at the boundary; do not mix mid-pipeline.

## Drizzle

snake_case columns. Do not redefine the column name as a string.

```ts
const t = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})
```

## Effect

- Don't return `Effect` from helpers that don't actually do effectful work.
- Services as `Effect.Service` with `Context.Tag` + a default `Layer`.
- Compose all layers in `apps/api/src/runtime.ts`.
- Bridge AI SDK streams (`ReadableStream`) out of Effect — don't try to model the stream inside Effect.

## Comments

Only when the *why* is non-obvious (a hidden constraint, a workaround, a surprising invariant). Never describe what the code does.
