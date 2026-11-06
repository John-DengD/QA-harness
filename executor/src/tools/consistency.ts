export type ConsistencyResult =
  | "API_FAIL_UI_PASS"
  | "API_PASS_UI_FAIL"
  | "BOTH_FAIL"
  | "CONSISTENT_PASS";

export const classifyConsistency = (
  apiFailed: boolean,
  uiFailed: boolean
): ConsistencyResult => {
  if (apiFailed && uiFailed) return "BOTH_FAIL";
  if (apiFailed) return "API_FAIL_UI_PASS";
  if (uiFailed) return "API_PASS_UI_FAIL";
  return "CONSISTENT_PASS";
};
