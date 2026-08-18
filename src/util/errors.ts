/** Thrown when a user lacks permission to run a command or subcommand. */
export class PermissionError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "PermissionError";
  }
}

/** Thrown when a referenced record (knowledge entry, channel config, ...) doesn't exist. */
export class NotFoundError extends Error {
  constructor(message = "That item couldn't be found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Thrown for malformed or out-of-range user input that Discord's own option types didn't catch. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Thrown when a feature is disabled (by config, missing intent, or missing provider). */
export class FeatureUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeatureUnavailableError";
  }
}

/** Thrown by the rate limiter when a user/guild exceeds an allowed rate. */
export class RateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super(`Rate limit exceeded. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`);
    this.name = "RateLimitError";
  }
}

/** Maps any error to a short, safe, user-facing message. Never leaks stack traces or internals. */
export function toUserMessage(err: unknown): string {
  if (
    err instanceof PermissionError ||
    err instanceof NotFoundError ||
    err instanceof ValidationError ||
    err instanceof FeatureUnavailableError ||
    err instanceof RateLimitError
  ) {
    return err.message;
  }
  return "Something went wrong handling that command. An administrator can check `/audit` for details.";
}
