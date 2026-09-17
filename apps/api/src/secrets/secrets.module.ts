import { Global, Logger, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { developmentKeyring, LocalSecretCipher, parseKeyring } from './local-secret-cipher';
import { SECRET_CIPHER, type SecretCipher } from './secret-cipher';

export function createSecretCipher(env: Pick<Env, 'NODE_ENV' | 'SECRET_KEYS'>): SecretCipher {
  if (env.SECRET_KEYS) return new LocalSecretCipher(parseKeyring(env.SECRET_KEYS));
  // env.ts üretimde SECRET_KEYS olmadan başlatmaz; buraya yalnızca geliştirme ve testte gelinir.
  new Logger('Secrets').warn('SECRET_KEYS is not set: using the public development key');
  return new LocalSecretCipher(developmentKeyring());
}

@Global()
@Module({
  providers: [{ provide: SECRET_CIPHER, inject: [ENV], useFactory: createSecretCipher }],
  exports: [SECRET_CIPHER],
})
export class SecretsModule {}
