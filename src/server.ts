import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import sirv from "sirv";

const staticFiles = sirv(fileURLToPath(new URL("./public/", import.meta.url)), {
  single: true,
  etag: true,
  ignores: [/\/\./],
});

const server = createServer((request, response) => {
  const pathname = Effect.runSync(
    Effect.try(() => new URL(request.url ?? "/", "http://localhost").pathname).pipe(
      Effect.orElseSucceed(() => undefined),
    ),
  );
  if (!pathname) {
    response.writeHead(400);
    response.end();
    return;
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    const method = request.method ?? "GET";
    const named = /^\/api\/hello\/([^/]+)$/.exec(pathname);
    if (pathname === "/api/hello" && (method === "GET" || method === "PUT")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "Hello, world!", method }));
    } else if (named?.[1]) {
      const result = Effect.runSync(
        Effect.try(() => decodeURIComponent(named[1]!)).pipe(
          Effect.match({
            onFailure: () => ({ status: 400, body: { error: "Invalid URL encoding" } }),
            onSuccess: name => ({ status: 200, body: { message: `Hello, ${name}!` } }),
          }),
        ),
      );
      response.writeHead(result.status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result.body));
    } else {
      response.writeHead(pathname === "/api/hello" ? 405 : 404, {
        "Content-Type": "application/json",
        ...(pathname === "/api/hello" ? { Allow: "GET, PUT" } : {}),
      });
      response.end(JSON.stringify({ error: "Not found or method not allowed" }));
    }
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }
  staticFiles(request, response);
});

const program = Effect.gen(function* () {
  const port = Number(process.env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return yield* Effect.fail(new Error("PORT must be an integer between 0 and 65535"));
  }
  yield* Effect.acquireRelease(
    Effect.callback<Server, Error>(resume => {
      server.once("error", error => resume(Effect.fail(error)));
      server.listen(port, "0.0.0.0", () => resume(Effect.succeed(server)));
    }),
    server => Effect.callback<void>(resume => {
      server.close(() => resume(Effect.succeed(undefined)));
      server.closeIdleConnections();
    }),
  );
  const address = server.address();
  if (address && typeof address !== "string") {
    console.log(`Server running at http://0.0.0.0:${address.port}`);
  }
  yield* Effect.callback<void>(resume => {
    const stop = () => resume(Effect.succeed(undefined));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return Effect.sync(() => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    });
  });
});

await Effect.runPromise(Effect.scoped(program));
