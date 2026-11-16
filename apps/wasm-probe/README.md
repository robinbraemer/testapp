# LILY Wasm runtime probe

A minimal Next.js App Router function with no filesystem, native addons, shell,
database, or outgoing network calls. It is a separate app from the Bun/Node testapp.

- `GET /api/sum` returns the fixed calculation `2 + 3` and module-lifetime observations.
- The production route has no library imports or untrusted input to decode.
- `bun install`, `bun run test`, `bun run build`, `bun run start`.

Check LILY's actual `runsOn`, `wasmUnits`, and `nodeUnits` deployment fields before
calling this a Wasm deployment. A successful HTTP response alone is not proof.
The initialization timestamp and counter can show whether observed requests share
module state, but do not prove scale-to-zero or explain platform billing.

Deploy only `apps/wasm-probe` from branch `lily-wasm-probe` into the existing project.
Do not redeploy or change the root Node app while running this probe.

The first probe used Effect for query validation. Native Next.js passed, but the
deployed Wasm route returned HTTP 500. This dependency-free baseline separates the
platform's basic function execution from its library compatibility.
