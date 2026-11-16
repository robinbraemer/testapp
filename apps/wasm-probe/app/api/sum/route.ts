export const dynamic = "force-dynamic";

const moduleInitializedAtMs = Date.now();
let invocationsInThisModule = 0;

function sum(a: number, b: number): number {
  return a + b;
}

export function GET(): Response {
  return Response.json({
    probe: "sum",
    a: 2,
    b: 3,
    result: sum(2, 3),
    moduleInitializedAtMs,
    invocationsInThisModule: ++invocationsInThisModule,
    respondedAtMs: Date.now(),
  }, { headers: { "Cache-Control": "no-store" } });
}
