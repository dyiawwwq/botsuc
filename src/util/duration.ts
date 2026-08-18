import { ValidationError } from "./errors.js";

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
};

/**
 * Parses a short duration string like "24h", "7d", or "45m" into
 * milliseconds. Intentionally minimal (single number + single unit) —
 * good enough for /summarize's "since" option without pulling in a full
 * date-math dependency.
 */
export function parseDurationToMs(input: string, opts: { maxMs?: number } = {}): number {
  const match = /^(\d+)\s*([mhd])$/i.exec(input.trim());
  if (!match) {
    throw new ValidationError(`Couldn't understand "${input}". Use a number plus m/h/d, e.g. "24h" or "7d".`);
  }
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const ms = amount * UNIT_MS[unit]!;
  if (ms <= 0) throw new ValidationError("Duration must be positive.");
  if (opts.maxMs && ms > opts.maxMs) {
    throw new ValidationError(`That's too long a window — max is ${Math.floor(opts.maxMs / UNIT_MS.d!)} day(s).`);
  }
  return ms;
}
