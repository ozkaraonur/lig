'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { apiFetch, ApiRequestError, MOCK_PLATFORM_URL } from '../../../lib/api';

const MESSAGES: Record<string, string> = {
  INVALID_TOKEN: 'Giriş bağlantısı geçersiz, süresi dolmuş ya da daha önce kullanılmış.',
  RATE_LIMITED: 'Çok fazla deneme yapıldı. Bir dakika sonra tekrar dene.',
  NETWORK: 'Sunucuya ulaşılamadı. API çalışıyor mu?',
};

/**
 * Platform uygulaması modülü `/auth/callback#token=...` adresiyle açar.
 * Token hemen adres çubuğundan silinir, API'ye gönderilir ve karşılığında HttpOnly oturum çerezi alınır.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // React geliştirme modunda effect'ler iki kez çalışır; token tek kullanımlık olduğu için bir kez gönderilir.
    if (started.current) return;
    started.current = true;

    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    window.history.replaceState(null, '', window.location.pathname);

    if (!token) {
      setError('Giriş bağlantısında token yok.');
      return;
    }

    apiFetch('/auth/session', { method: 'POST', body: JSON.stringify({ token }) })
      .then(() => router.replace('/'))
      .catch((e: unknown) => {
        const code = e instanceof ApiRequestError ? e.code : 'NETWORK';
        setError(MESSAGES[code] ?? 'Giriş yapılamadı.');
      });
  }, [router]);

  return (
    <main>
      <h1>Giriş yapılıyor</h1>
      {error ? (
        <>
          <p role="alert">{error}</p>
          <p>
            <a href={MOCK_PLATFORM_URL}>Platforma dön ve tekrar dene</a>
          </p>
        </>
      ) : (
        <p>Bir saniye...</p>
      )}
    </main>
  );
}
