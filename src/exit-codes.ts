export const ExitCode = { OK: 0, CONFIG: 2, EXTERNAL: 3, PRODUCT_FAIL: 10, INCOMPLETE: 20 } as const;

/** Lowest non-zero code wins (spec §7); 0 when nothing failed. */
export function combineExit(codes: number[]): number {
  const failing = codes.filter((c) => c !== 0);
  return failing.length === 0 ? 0 : Math.min(...failing);
}
