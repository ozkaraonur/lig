import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SigningKeys {
  privateKeyPem: string;
  publicKeyPem: string;
}

/**
 * Sahte platformun imza anahtarları. İlk açılışta üretilir, `keys/` klasörüne yazılır ve
 * sonraki açılışlarda aynısı kullanılır. Klasör .gitignore'da; özel anahtar asla repoya girmez.
 */
export function loadOrCreateKeys(directory: string): SigningKeys {
  const privatePath = join(directory, 'private.pem');
  const publicPath = join(directory, 'public.pem');

  if (existsSync(privatePath) && existsSync(publicPath)) {
    return {
      privateKeyPem: readFileSync(privatePath, 'utf8'),
      publicKeyPem: readFileSync(publicPath, 'utf8'),
    };
  }

  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  mkdirSync(directory, { recursive: true });
  writeFileSync(privatePath, privateKey, { mode: 0o600 });
  writeFileSync(publicPath, publicKey, { mode: 0o644 });
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}
