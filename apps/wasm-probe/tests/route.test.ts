import { expect, test } from "bun:test";
import { Effect } from "effect";
import { GET } from "../app/api/sum/route";

test("adds fixed operands without caching", async () => {
  const response = GET();
  const body = await Effect.runPromise(Effect.tryPromise(() => response.json()));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(body).toMatchObject({ a: 2, b: 3, result: 5, probe: "sum" });
});

test("exposes module-local observations across invocations", async () => {
  const first = await Effect.runPromise(Effect.tryPromise(() =>
    GET().json(),
  ));
  const second = await Effect.runPromise(Effect.tryPromise(() =>
    GET().json(),
  ));
  expect(first.result).toBe(5);
  expect(second.result).toBe(5);
  expect(first.moduleInitializedAtMs).toBe(second.moduleInitializedAtMs);
  expect(second.invocationsInThisModule).toBe(first.invocationsInThisModule + 1);
  expect(second.respondedAtMs).toBeGreaterThanOrEqual(first.respondedAtMs);
});
