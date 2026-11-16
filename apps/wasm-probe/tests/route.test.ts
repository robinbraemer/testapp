import { expect, test } from "bun:test";
import { Effect } from "effect";
import { GET } from "../app/api/sum/route";

test("adds default operands without caching", async () => {
  const response = GET(new Request("http://localhost/api/sum"));
  const body = await Effect.runPromise(Effect.tryPromise(() => response.json()));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(body).toMatchObject({ a: 2, b: 3, result: 5, probe: "sum" });
});

test("accepts signed integers and exposes module-local observations", async () => {
  const first = await Effect.runPromise(Effect.tryPromise(() =>
    GET(new Request("http://localhost/api/sum?a=-10&b=17")).json(),
  ));
  const second = await Effect.runPromise(Effect.tryPromise(() =>
    GET(new Request("http://localhost/api/sum?a=1000000&b=-1000000")).json(),
  ));
  expect(first.result).toBe(7);
  expect(second.result).toBe(0);
  expect(first.moduleInitializedAt).toBe(second.moduleInitializedAt);
  expect(second.invocationsInThisModule).toBe(first.invocationsInThisModule + 1);
});

test.each(["a=NaN", "a=1.5", "a=1000001", "b=-1000001", "b="])(
  "rejects invalid input: %s",
  query => {
    expect(GET(new Request(`http://localhost/api/sum?${query}`)).status).toBe(400);
  },
);
