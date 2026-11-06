/**
 * Levels for raw Computer Use steps (`computer-use act --side-effect`), which
 * have no Action table row. Library Actions run through `e2b:action` do not use
 * these: their rollback level (read | reversible | irreversible) is a property
 * in the Action table (action-table.ts), where side_effect and
 * irreversible_high_impact both read as irreversible.
 */
export const SIDE_EFFECT_LEVELS = [
  "read",
  "reversible",
  "side_effect",
  "irreversible_high_impact",
] as const;

export type SideEffectLevel = (typeof SIDE_EFFECT_LEVELS)[number];

export type ComputerUseAction =
  | {
      type: "click";
      x: number;
      y: number;
      button?: "left" | "right" | "middle";
      count?: 1 | 2;
    }
  | { type: "type"; text: string }
  | { type: "type-env"; env: string }
  | { type: "press"; keys: string | string[] }
  | { type: "scroll"; direction: "up" | "down"; amount: number }
  | { type: "drag"; from: [number, number]; to: [number, number] }
  | { type: "wait"; ms: number };

export type TraceAction =
  | Exclude<ComputerUseAction, { type: "type" } | { type: "type-env" }>
  | { type: "type"; text: "<redacted>"; textLength: number }
  | { type: "type-env"; env: string; value: "<sandbox-env>" };

export type ComputerUseTraceStep = {
  step: number;
  capturedAt: string;
  intent: string;
  sideEffect: SideEffectLevel;
  immediateExpected: string;
  observed: string | null;
  status: "completed" | "failed" | "action_unknown";
  action: TraceAction;
  beforeScreenshot: string;
  afterScreenshot: string | null;
  error: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteCoordinate(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > max
  ) {
    throw new Error(`${label} must be an integer between 1 and ${max}`);
  }
  return value;
}

function point(value: unknown, label: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${label} must be a two-item coordinate tuple`);
  }
  return [
    finiteCoordinate(value[0], `${label}[0]`),
    finiteCoordinate(value[1], `${label}[1]`),
  ];
}

export function parseComputerUseAction(json: string): ComputerUseAction {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("action must be a JSON object with a type");
  }

  switch (value.type) {
    case "click": {
      const button = value.button ?? "left";
      const count = value.count ?? 1;
      if (!(["left", "right", "middle"] as unknown[]).includes(button)) {
        throw new Error("click.button must be left, right, or middle");
      }
      if (count !== 1 && count !== 2) {
        throw new Error("click.count must be 1 or 2");
      }
      if (count === 2 && button !== "left") {
        throw new Error("double click is supported only for the left button");
      }
      return {
        type: "click",
        x: finiteCoordinate(value.x, "click.x"),
        y: finiteCoordinate(value.y, "click.y"),
        button: button as "left" | "right" | "middle",
        count,
      };
    }
    case "type":
      if (typeof value.text !== "string" || value.text.length === 0) {
        throw new Error("type.text must be a non-empty string");
      }
      return { type: "type", text: value.text };
    case "type-env":
      if (
        typeof value.env !== "string" ||
        !/^[A-Z][A-Z0-9_]*$/.test(value.env)
      ) {
        throw new Error("type-env.env must be an uppercase environment name");
      }
      return { type: "type-env", env: value.env };
    case "press": {
      const keys = value.keys;
      if (
        !(
          (typeof keys === "string" && keys.length > 0) ||
          (Array.isArray(keys) &&
            keys.length > 0 &&
            keys.every((key) => typeof key === "string" && key.length > 0))
        )
      ) {
        throw new Error("press.keys must be a key or non-empty key array");
      }
      return { type: "press", keys: keys as string | string[] };
    }
    case "scroll":
      if (value.direction !== "up" && value.direction !== "down") {
        throw new Error("scroll.direction must be up or down");
      }
      return {
        type: "scroll",
        direction: value.direction,
        amount: positiveInteger(value.amount, "scroll.amount", 100),
      };
    case "drag":
      return {
        type: "drag",
        from: point(value.from, "drag.from"),
        to: point(value.to, "drag.to"),
      };
    case "wait":
      return {
        type: "wait",
        ms: positiveInteger(value.ms, "wait.ms", 30_000),
      };
    default:
      throw new Error(`Unsupported computer-use action: ${value.type}`);
  }
}

export function parseSideEffect(value: string): SideEffectLevel {
  if ((SIDE_EFFECT_LEVELS as readonly string[]).includes(value)) {
    return value as SideEffectLevel;
  }
  throw new Error(`Unsupported side-effect level: ${value}`);
}

export function sanitizeActionForTrace(action: ComputerUseAction): TraceAction {
  if (action.type === "type") {
    return { type: "type", text: "<redacted>", textLength: action.text.length };
  }
  if (action.type === "type-env") {
    return { type: "type-env", env: action.env, value: "<sandbox-env>" };
  }
  return action;
}

export function traceFailureStatus(
  sideEffect: SideEffectLevel
): "failed" | "action_unknown" {
  return sideEffect === "read" ? "failed" : "action_unknown";
}
