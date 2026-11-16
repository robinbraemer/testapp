# LILY Wasm runtime probe

A minimal Next.js App Router function with no filesystem, native addons, shell,
database, or outgoing network calls. It is a separate app from the Bun/Node testapp.

- `GET /` or `GET /api/sum?a=2&b=3` returns a sum and module-lifetime observations.
- Invalid integer operands return HTTP 400.
- `bun install`, `bun run test`, `bun run build`, `bun run start`.

Check LILY's actual `runsOn`, `wasmUnits`, and `nodeUnits` deployment fields before
calling this a Wasm deployment. A successful HTTP response alone is not proof.
The initialization timestamp and counter can show whether observed requests share
module state, but do not prove scale-to-zero or explain platform billing.

Deploy only `apps/wasm-probe` from branch `lily-wasm-probe` into the existing project.
Do not redeploy or change the root Node app while running this probe.
