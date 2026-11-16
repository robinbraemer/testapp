import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { NodeServices } from "@effect/platform-node";
import { Effect, Option, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";

class RemoteExecError extends Schema.TaggedError<RemoteExecError>()("RemoteExecError", {
  status: Schema.Number,
  message: Schema.String,
}) {}

const decodeRequest = Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({
  kind: Schema.Literals(["shell", "js"]),
  code: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(8192)),
})));

const passwordHash = Option.match(
  Schema.decodeUnknownOption(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)))(
    process.env.REMOTE_EXEC_PASSWORD_SHA256,
  ),
  { onNone: () => undefined, onSome: hash => Buffer.from(hash, "hex") },
);
let busy = false;

const collect = Effect.fnUntraced(function* <E>(
  stream: Stream.Stream<Uint8Array, E>,
  limit: number,
) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  yield* Stream.runForEach(stream, chunk => Effect.suspend(() => {
    bytes += chunk.byteLength;
    if (bytes > limit) {
      return Effect.fail(new RemoteExecError({ status: 413, message: "Byte limit exceeded" }));
    }
    chunks.push(Buffer.from(chunk));
    return Effect.succeed(undefined);
  }));
  return Buffer.concat(chunks).toString("utf8");
});

const execute = Effect.fnUntraced(function* (request: IncomingMessage) {
  if (!passwordHash) {
    return yield* new RemoteExecError({ status: 404, message: "Not found" });
  }
  const suppliedHash = createHash("sha256").update(request.headers.authorization ?? "").digest();
  if (!timingSafeEqual(passwordHash, suppliedHash)) {
    return yield* new RemoteExecError({ status: 401, message: "Unauthorized" });
  }
  if (request.method !== "POST") {
    return yield* new RemoteExecError({ status: 405, message: "Use POST" });
  }
  if (request.headers.origin !== undefined) {
    return yield* new RemoteExecError({ status: 403, message: "Browser-origin requests are disabled" });
  }
  if (request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") {
    return yield* new RemoteExecError({ status: 415, message: "Use application/json" });
  }
  yield* Effect.acquireRelease(
    Effect.suspend(() => {
      if (busy) return Effect.fail(new RemoteExecError({ status: 429, message: "An execution is already running" }));
      busy = true;
      return Effect.succeed(undefined);
    }),
    () => Effect.sync(() => { busy = false; }),
  );
  const body = yield* collect(
    Stream.fromAsyncIterable(request, () =>
      new RemoteExecError({ status: 400, message: "Could not read request" })),
    16 * 1024,
  ).pipe(Effect.timeoutOrElse({
    duration: "5 seconds",
    orElse: () => Effect.fail(new RemoteExecError({ status: 408, message: "Request body timed out" })),
  }));
  const payload = yield* decodeRequest(body).pipe(
    Effect.mapError(() => new RemoteExecError({ status: 400, message: "Expected kind (shell or js) and code (1-8192 characters)" })),
  );
  return yield* Effect.gen(function* () {
    const options = {
      stdin: "ignore",
      extendEnv: true,
      env: { REMOTE_EXEC_PASSWORD: undefined, REMOTE_EXEC_PASSWORD_SHA256: undefined },
      killSignal: "SIGKILL",
      forceKillAfter: "100 millis",
    } as const;
    const child = yield* (
      payload.kind === "js"
        ? ChildProcess.make(process.execPath, [
          "--max-old-space-size=64", "--input-type=module", "--eval", payload.code,
        ], options)
        : ChildProcess.make("/bin/sh", ["-c", payload.code], options)
    );
    return yield* Effect.all({
      stdout: collect(child.stdout, 32 * 1024),
      stderr: collect(child.stderr, 32 * 1024),
      exitCode: child.exitCode,
    }, { concurrency: "unbounded" });
  }).pipe(
    Effect.scoped,
    Effect.timeoutOrElse({
      duration: "5 seconds",
      orElse: () => Effect.fail(new RemoteExecError({ status: 504, message: "Execution timed out" })),
    }),
  );
});

export const handleRemoteExec = (request: IncomingMessage, response: ServerResponse) =>
  Effect.scoped(execute(request)).pipe(
    Effect.provide(NodeServices.layer),
    Effect.match({
      onFailure: error => {
        if (response.destroyed) return;
        const expected = error instanceof RemoteExecError;
        const status = expected ? error.status : 503;
        response.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          ...(status === 405 ? { Allow: "POST" } : {}),
          ...(status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
        });
        response.end(JSON.stringify({
          error: expected ? error.message : "Execution unavailable in this runtime",
        }));
      },
      onSuccess: result => {
        if (response.destroyed) return;
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify(result));
      },
    }),
  );
