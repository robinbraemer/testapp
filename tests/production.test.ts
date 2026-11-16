import { afterAll, beforeAll, expect, test } from "bun:test";
import { Effect } from "effect";

let child: ReturnType<typeof Bun.spawn>;
let origin: string;

beforeAll(async () => {
  child = Bun.spawn(["node", "dist/server.js"], {
    env: { ...process.env, PORT: "0", REMOTE_EXEC_PASSWORD_SHA256: "" },
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  origin = await Effect.runPromise(
    Effect.gen(function* () {
      let output = "";
      while (true) {
        const chunk = yield* Effect.tryPromise(() => reader.read());
        if (chunk.done) return yield* Effect.fail(new Error("Server exited before listening"));
        output += decoder.decode(chunk.value, { stream: true });
        const port = /Server running at http:\/\/0\.0\.0\.0:(\d+)/.exec(output)?.[1];
        if (port) return `http://127.0.0.1:${port}`;
      }
    }).pipe(Effect.timeout("10 seconds")),
  );
  reader.releaseLock();
});

afterAll(async () => {
  child?.kill("SIGTERM");
  if (child) {
    const code = await Effect.runPromise(
      Effect.tryPromise(() => child.exited).pipe(Effect.timeout("10 seconds")),
    );
    expect(code).toBe(0);
  }
});

const request = (path: string, init?: RequestInit) => Effect.runPromise(
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise(() => fetch(`${origin}${path}`, init));
    const body = yield* Effect.tryPromise(() => response.text());
    return { response, body };
  }),
);

test("serves the built page and every referenced asset", async () => {
  const page = await request("/");
  expect(page.response.status).toBe(200);
  expect(page.response.headers.get("content-type")).toContain("text/html");
  expect(page.body).toContain('id="root"');
  const assets = [...page.body.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)];
  expect(assets.length).toBeGreaterThanOrEqual(2);
  for (const asset of assets) {
    const { response, body } = await request(new URL(asset[1]!, `${origin}/`).pathname);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).not.toContain("text/html");
    expect(body.length).toBeGreaterThan(0);
  }
});

test.each(["GET", "PUT"])("%s /api/hello preserves the API response", async method => {
  const { response, body } = await request("/api/hello", { method });
  expect(response.status).toBe(200);
  expect(JSON.parse(body)).toEqual({ message: "Hello, world!", method });
});

test("decodes names without losing plus signs or ampersands", async () => {
  const { response, body } = await request("/api/hello/Robin%20%26%20A+B");
  expect(response.status).toBe(200);
  expect(JSON.parse(body)).toEqual({ message: "Hello, Robin & A+B!" });
});

test("malformed encoding returns 400 without crashing the server", async () => {
  expect((await request("/api/hello/%ZZ")).response.status).toBe(400);
  expect((await request("/")).response.status).toBe(200);
});

test("supports SPA navigation and HEAD requests", async () => {
  expect((await request("/nested/page")).response.status).toBe(200);
  const head = await request("/", { method: "HEAD" });
  expect(head.response.status).toBe(200);
  expect(head.body).toBe("");
});

test("does not return HTML for unknown API routes or unsupported methods", async () => {
  const missing = await request("/api/missing");
  expect(missing.response.status).toBe(404);
  expect(missing.response.headers.get("content-type")).toContain("application/json");
  expect((await request("/api/hello", { method: "POST" })).response.status).toBe(405);
  expect((await request("/", { method: "POST" })).response.status).toBe(405);
});

test.each(["/missing.js", "/server.js", "/package.json", "/.env", "/%2e%2e/server.js"])(
  "does not expose missing assets or server files at %s",
  async path => {
    expect((await request(path)).response.status).toBe(404);
  },
);

test("remote execution is disabled without a password", async () => {
  const result = await request("/api/admin/exec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "js", code: 'console.log("must not execute")' }),
  });
  expect(result.response.status).toBe(404);
  expect(result.response.headers.get("cache-control")).toBe("no-store");
});
