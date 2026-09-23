import type { ErrorCode } from '@tm/shared';

export class AppError extends Error {
  constructor(public code: ErrorCode, message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}
