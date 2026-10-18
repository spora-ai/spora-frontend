/**
 * Compile-time exhaustiveness check for a union that `strict` will not cover.
 *
 * `noImplicitReturns` is not enabled in this repo's tsconfig, so a `switch`
 * over a union with no `default` type-checks happily while returning
 * `undefined` at runtime — and a function typed `boolean` will happily pass
 * that along. Passing the value to a `never` parameter makes the missing case
 * a type error instead.
 */
export function assertUnreachable(value: never): never {
  throw new Error(`Unreachable: ${String(value)}`);
}
