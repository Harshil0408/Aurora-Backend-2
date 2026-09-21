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
): ApiPaginated<T> {
  return {
    success: true,
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
