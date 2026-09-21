export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;
  readonly isOperational: boolean;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS[code];
    this.details = details;
    this.isOperational = true;
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError('BAD_REQUEST', message, details);
export const unauthorized = (message = 'Unauthorized'): AppError =>
  new AppError('UNAUTHORIZED', message);
export const forbidden = (message = 'Forbidden'): AppError => new AppError('FORBIDDEN', message);
export const notFound = (message = 'Not found'): AppError => new AppError('NOT_FOUND', message);
export const conflict = (message: string): AppError => new AppError('CONFLICT', message);
export const serviceUnavailable = (message: string): AppError =>
  new AppError('SERVICE_UNAVAILABLE', message);
