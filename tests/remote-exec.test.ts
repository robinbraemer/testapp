import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { Effect, Option, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";

const password = "test-only-remote-exec-password-not-a-real-secret";
const decodeResponse = Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({
  stdout: Schema.optional(Schema.String),
  stderr: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
})));

const withServer = Effect.fnUntraced(
  function* (
    password: string,
    check: (origin: string) => Effect.Effect<void, unknown>,
  ) {
    const child = yield* ChildProcess.make("node", ["dist/server.js"], {
      extendEnv: true,
      env: {
        PORT: "0",
        REMOTE_EXEC_PASSWORD_SHA256: password.length >= 32
          ? createHash("sha256").update(`Bearer ${password}`).digest("hex")
          : password,
      },
      stdin: "ignore",
      forceKillAfter: "100 millis",
    });
    const line = yield* child.stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.filter(line => line.startsWith("Server running at ")),
      Stream.runHead,
    );
    if (Option.isNone(line)) return yield* Effect.fail(new Error("Server did not start"));
    const origin = line.value.replace("Server running at http://0.0.0.0:", "http://127.0.0.1:");
    yield* check(origin);
  },
  Effect.scoped,
  Effect.provide(NodeServices.layer),
  Effect.timeout("15 seconds"),
);

const send = Effect.fnUntraced(function* (
  origin: string,
  token: string,
  payload: unknown,
  init: RequestInit = {},
) {
  const response = yield* Effect.tryPromise(() => fetch(`${origin}/api/admin/exec`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    ...init,
  }));
  const text = yield* Effect.tryPromise(() => response.text());
  return { response, body: yield* decodeResponse(text) };
});

test.each(["", "invalid-hash"])("remote execution stays disabled with an absent or invalid hash (%s)", async value => {
  await Effect.runPromise(withServer(value, Effect.fnUntraced(function* (origin) {
    const result = yield* send(origin, password, { kind: "js", code: 'console.log("not allowed")' });
    expect(result.response.status).toBe(404);
    expect(result.response.headers.get("cache-control")).toBe("no-store");
  })));
});

test("missing or incorrect credentials never authorize execution", async () => {
  await Effect.runPromise(withServer(password, Effect.fnUntraced(function* (origin) {
    for (const token of [
      "", "wrong", `${password}wrong`,
      createHash("sha256").update(`Bearer ${password}`).digest("hex"),
    ]) {
      const result = yield* send(origin, token, { kind: "js", code: 'console.log("not allowed")' });
      expect(result.response.status).toBe(401);
      expect(result.body.stdout).toBeUndefined();
    }
  })));
});

test("JavaScript runs in a child, supports await, and does not inherit the authentication password", async () => {
  await Effect.runPromise(withServer(password, Effect.fnUntraced(function* (origin) {
    const result = yield* send(origin, password, {
      kind: "js",
      code: 'await Promise.resolve(); console.log(process.version); console.log(Object.hasOwn(process.env, "REMOTE_EXEC_PASSWORD_SHA256")); console.error("diagnostic");',
    });
    expect(result.response.status).toBe(200);
    expect(result.body.stdout).toMatch(/^v\d+\..*\nfalse\n$/);
    expect(result.body.stderr).toBe("diagnostic\n");
    expect(result.body.exitCode).toBe(0);
    expect(result.response.headers.get("cache-control")).toBe("no-store");
  })));
});

test("shell mode captures stdout, stderr and nonzero exit codes", async () => {
  await Effect.runPromise(withServer(password, Effect.fnUntraced(function* (origin) {
    const result = yield* send(origin, password, {
      kind: "shell",
      code: "printf shell-ok; printf warning >&2; exit 7",
    });
    expect(result.response.status).toBe(200);
    expect(result.body).toEqual({ stdout: "shell-ok", stderr: "warning", exitCode: 7 });
  })));
});

test.each([
  {},
  { kind: "other", code: "hello" },
  { kind: "js", code: "" },
  { kind: "js", code: 123 },
  { kind: "js", code: "a".repeat(8193) },
])("invalid payloads return 400", async payload => {
  await Effect.runPromise(withServer(password, Effect.fnUntraced(function* (origin) {
    expect((yield* send(origin, password, payload)).response.status).toBe(400);
  })));
});

test("malformed JSON and oversized bodies are rejected", async () => {
  await Effect.runPromise(withServer(password, Effect.fnUntraced(function* (origin) {
    expect((yield* send(origin, password, {}, { body: "{" })).response.status).toBe(400);
    expect((yield* send(origin, password, { kind: "js", code: "a".repeat(20000) })).response.status).toBe(413);
  })));
});

test("browser-origin requests, wrong content types and non-POST methods are rejected", async () => {
  await Effect.runPromise(withServer(password, Effect.fnUntraced(function* (origin) {
    expect((yield* send(origin, password, {}, {
      headers: { Authorization: `Bearer ${password}`, "Content-Type": "application/json", Origin: origin },
    })).response.status).toBe(403);
    expect((yield* send(origin, password, {}, {
      headers: { Authorization: `Bearer ${password}`, "Content-Type": "text/plain" },
    })).response.status).toBe(415);
    expect((yield* send(origin, password, {}, { method: "GET", body: undefined })).response.status).toBe(405);
  })));
});

test.each(["stdout", "stderr"])("excess %s terminates execution without returning oversized output", async stream => {
  await Effect.runPromise(withServer(password, Effect.fnUntraced(function* (origin) {
    const result = yield* send(origin, password, {
      kind: "js",
      code: `process.${stream}.write("x".repeat(100000));`,
    });
    expect(result.response.status).toBe(413);
    const healthy = yield* send(origin, password, { kind: "js", code: 'console.log("still healthy")' });
    expect(healthy.response.status).toBe(200);
    expect(healthy.body.stdout).toBe("still healthy\n");
  })));
});

test("an infinite JavaScript loop times out without blocking the app or leaking its execution slot", async () => {
  await Effect.runPromise(withServer(password, Effect.fnUntraced(function* (origin) {
    const result = yield* send(origin, password, { kind: "js", code: "while (true) {}" });
    expect(result.response.status).toBe(504);
    const healthy = yield* send(origin, password, { kind: "js", code: 'console.log("still healthy")' });
    expect(healthy.response.status).toBe(200);
    expect(healthy.body.stdout).toBe("still healthy\n");
  })));
}, 15000);
