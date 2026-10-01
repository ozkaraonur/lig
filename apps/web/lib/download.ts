import { type ApiError } from '@lig/shared';
import { API_URL, ApiRequestError } from './api';

/**
 * Yönetici CSV dosyasını indirir (FR-25). Dosya, oturum çerezi gerektiren bir istekle gelir; bu yüzden
 * bağlantı yerine fetch ve geçici bir bağlantı kullanılır.
 */
export async function downloadFile(path: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { credentials: 'include' });
  } catch {
    throw new ApiRequestError(0, 'NETWORK', 'Sunucuya ulaşılamadı.');
  }
  if (!res.ok) {
    const error = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(
      res.status,
      error?.code ?? 'INTERNAL',
      error?.message ?? 'Beklenmeyen bir hata oluştu.',
    );
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'lig.csv';
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
