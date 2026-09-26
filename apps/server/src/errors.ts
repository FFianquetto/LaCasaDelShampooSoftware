export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "APP_ERROR",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function assertFound<T>(
  value: T | null | undefined,
  message: string,
): T {
  if (value == null) throw new AppError(message, 404, "NOT_FOUND");
  return value;
}
