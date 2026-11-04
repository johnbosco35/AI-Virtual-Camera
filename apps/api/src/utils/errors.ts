export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const isDuplicateKeyError = (e: unknown): e is { code: 11000; keyPattern?: Record<string, number> } =>
  typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;
