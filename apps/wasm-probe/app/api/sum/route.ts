import { Effect, Schema } from "effect";

export const dynamic = "force-dynamic";

const Operand = Schema.String.check(Schema.isPattern(/^-?\d+$/)).pipe(
  Schema.decodeTo(Schema.NumberFromString.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(-1_000_000),
    Schema.isLessThanOrEqualTo(1_000_000),
  )),
);
const decode = Schema.decodeUnknownEffect(Schema.Struct({ a: Operand, b: Operand }));
const moduleInitializedAt = new Date().toISOString();
let invocationsInThisModule = 0;

export function GET(request: Request): Response {
  const params = new URL(request.url).searchParams;
  return Effect.runSync(
    Effect.gen(function* () {
      const { a, b } = yield* decode({
        a: params.get("a") ?? "2",
        b: params.get("b") ?? "3",
      });
      return Response.json({
        probe: "sum",
        a,
        b,
        result: a + b,
        moduleInitializedAt,
        invocationsInThisModule: ++invocationsInThisModule,
        respondedAt: new Date().toISOString(),
      }, { headers: { "Cache-Control": "no-store" } });
    }).pipe(Effect.catch(() => Effect.succeed(
      Response.json(
        { error: "a and b must be integers between -1000000 and 1000000" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      ),
    ))),
  );
}
