/**
 * Yeni bir şifreleme anahtarı üretir ve .env'e eklenecek satırı yazar.
 * Kullanım: npm run secrets:new-key            (ilk anahtar, kimlik "k1")
 *           npm run secrets:new-key -- k2      (anahtar değişimi için)
 */
import { generateKeyEntry } from './local-secret-cipher';

/** Komutun asıl çıktısı stdout'a; ipuçları stderr'e. */
const print = (line: string) => process.stdout.write(`${line}\n`);

const id = process.argv[2] ?? 'k1';
const entry = generateKeyEntry(id);
print(`SECRET_KEYS=${entry}`);
console.error(
  id === 'k1'
    ? '\nBu satırı .env dosyasına ekle. Anahtarı kaybedersen şifreli kayıtlar okunamaz.'
    : `\nAnahtar değişimi: yeni anahtarı başa ekle, eskisini arkada bırak (SECRET_KEYS=${id}:...,k1:...),\nsonra "npm run secrets:rotate" çalıştır.`,
);
