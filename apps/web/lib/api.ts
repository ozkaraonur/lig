import { type ApiError, type ErrorCode } from '@lig/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const MOCK_PLATFORM_URL = process.env.NEXT_PUBLIC_MOCK_PLATFORM_URL ?? 'http://localhost:4100';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
  ) {
    super(message);
  }
}

/** API'ye istek atar. Oturum çerezi `credentials: 'include'` ile otomatik gider; token JavaScript'e hiç gelmez. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK', 'Sunucuya ulaşılamadı.');
  }

  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok) {
    const error = body as ApiError | null;
    throw new ApiRequestError(
      res.status,
      error?.code ?? 'INTERNAL',
      error?.message ?? 'Beklenmeyen bir hata oluştu.',
    );
  }
  return body as T;
}
