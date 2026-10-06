import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import type { NextConfig } from 'next';

// Web de repo kökündeki tek .env'den NEXT_PUBLIC_API_URL ve NEXT_PUBLIC_MOCK_PLATFORM_URL'yi okur. Yalnızca
// NEXT_PUBLIC_ ile başlayanlar alınır: veritabanı parolası ve şifreleme anahtarı web sürecine girmez.
// Bu değerler derleme anında koda gömülür; adresi değiştirince `npm run build -w @lig/web` yeniden çalışmalı.
// Zaten tanımlı ortam değişkenini ezmez.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(rootEnv, 'utf8')))) {
    if (key.startsWith('NEXT_PUBLIC_') && value !== undefined) process.env[key] ??= value;
  }
}

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@lig/shared'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
