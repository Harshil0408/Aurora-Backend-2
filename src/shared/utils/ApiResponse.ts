export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiPaginated<T> {
  success: true;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function ok<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

export function paginated<T>(
  data: T[],
  page: number,
  limit: number,
  total: number,
  meta?: Record<string, unknown>,
): ApiPaginated<T> & { meta?: Record<string, unknown> } {
  return {
    success: true,
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    ...(meta !== undefined ? { meta } : {}),
  };
}
