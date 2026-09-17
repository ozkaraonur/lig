# Tehdit modeli

> Sahibi: Onur. Aşağıdaki liste başlangıç taslağıdır; STRIDE ile genişletilip her tehdide karşı kontrol ve test eklenecek.

## Kapsam ve güven sınırları

1. **Müşteri platformu → Lig API:** oyuncu token'ı, fiyat akışı, gerçek işlem webhook'u
2. **Oyuncu tarayıcısı (WebView) → Lig API:** oturum çerezi ile REST istekleri
3. **Yönetici tarayıcısı → Lig API:** yönetim paneli
4. **Lig API → PostgreSQL / Redis / LLM API**

## Varlıklar

- Tenant verisinin ayrılığı (bir platform diğerinin verisini görmemeli)
- Sıralamanın bütünlüğü (hile ile üst sıraya çıkılamamalı)
- Platformun imza anahtarı ve yönetici hesapları
- Oyuncu takma kimlikleri ve işlem geçmişi (KVKK)

## İlk tehdit listesi

| #   | STRIDE                 | Tehdit                                                                | Planlanan kontrol                                                                                                                                                               | Durum                               |
| --- | ---------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| T1  | Spoofing               | Sahte ya da çalınmış oyuncu token'ı ile başka oyuncu olarak giriş     | Sadece RS256; `iss` ile platform bulunur ve yalnız onun anahtarıyla doğrulanır; `aud`, `exp`, `iat` kontrolü; ömür ≤ 5 dk; `jti` tek kullanım (Redis); genel hata mesajı        | Faz 1 ✓                             |
| T2  | Tampering              | Eski fiyattan emir vererek kesin kazanç (fiyat arbitrajı)             | Fiyat yaşı ≤ 5 sn, fiyat istemciden alınmaz, sunucu tarafında okunur                                                                                                            | Faz 1 ✓                             |
| T3  | Tampering              | Aynı emri paralel gönderip bakiyeyi eksiye düşürme (race condition)   | Tek transaction, satır kilidi, `cash >= 0` CHECK kısıtı, idempotency key                                                                                                        | Faz 1 ✓                             |
| T4  | Information disclosure | Tenant A'nın yöneticisi tenant B'nin verisini görür (IDOR)            | Her sorguda tenant filtresi, yetki testleri, Faz 4'te PostgreSQL RLS                                                                                                            | Oyuncu lig uçları ✓, Faz 2–4        |
| T5  | Spoofing               | Sahte webhook ile dönüşüm metriğini şişirme                           | HMAC imzası, zaman damgası penceresi, `external_event_id` benzersizliği                                                                                                         | Faz 2                               |
| T6  | Elevation of privilege | Yönetici hesabının ele geçirilmesi                                    | Güçlü parola hash'i (argon2id), zorunlu MFA, oturum süresi, giriş denemesi sınırı                                                                                               | Faz 2                               |
| T7  | Repudiation            | Lig ayarının kim tarafından değiştirildiğinin inkârı                  | Değiştirilemez denetim kaydı (NFR-07)                                                                                                                                           | Faz 2                               |
| T8  | Tampering              | Prompt injection ile AI koçun al/sat önerisi vermesi                  | Çıktı filtresi, sistem talimatı, yanıt kaydı, kötü niyetli girdi test seti                                                                                                      | Faz 3                               |
| T9  | Denial of service      | Emir ve sıralama uçlarına yoğun istek                                 | Oyuncu ve tenant başına rate limit, gövde boyutu sınırı (64 KB)                                                                                                                 | Oyuncu uçları ✓, tenant bazlı Faz 4 |
| T10 | Information disclosure | Secret'ların repoya ya da loga sızması                                | `.gitignore`, CI'da gitleaks, logda secret yazmama kuralı, env doğrulaması                                                                                                      | Faz 0 ✓                             |
| T11 | Tampering / SSRF       | Fiyat akışı ile sahte fiyat ya da API'yi iç ağa istek atmaya yöneltme | Fiyat adresi yalnızca kurulumda girilir, üretimde sadece https, yönlendirme takip edilmez, 2 sn zaman aşımı, 256 KB sınırı; her fiyat ayrı doğrulanır, eski fiyat yeniyi ezemez | Faz 1 ✓                             |

## T1 uygulama ayrıntısı (Faz 1)

**Kod:** `apps/api/src/auth/player-token.verifier.ts`. **Testler:** `player-token.verifier.test.ts` (19 test), `auth.e2e.test.ts` (10 test).

| Saldırı                                                              | Sonuç                             | Test |
| -------------------------------------------------------------------- | --------------------------------- | ---- |
| `alg: none`                                                          | 401, imzaya bakılmadan reddedilir | ✓    |
| HS256 ile açık anahtarı secret olarak kullanma (anahtar karışıklığı) | 401                               | ✓    |
| İmzadan sonra payload değiştirme                                     | 401                               | ✓    |
| B platformunun anahtarıyla A platformu adına token                   | 401                               | ✓    |
| Bilinmeyen `iss`                                                     | 401                               | ✓    |
| Başka hizmet için üretilmiş token (`aud`)                            | 401                               | ✓    |
| Süresi dolmuş token (5 sn saat toleransı dışında)                    | 401                               | ✓    |
| Gelecekte üretilmiş token                                            | 401                               | ✓    |
| Ömrü 5 dakikadan uzun token                                          | 401                               | ✓    |
| `jti` olmayan token                                                  | 401                               | ✓    |
| Aynı token'ı ikinci kez kullanma                                     | 401                               | ✓    |
| `sub` ya da `name` içinde HTML / geçersiz karakter                   | 401                               | ✓    |
| Dakikada 20'den fazla giriş denemesi (IP başına)                     | 429 + `Retry-After`               | ✓    |
| Sahte oturum çerezi                                                  | 401                               | ✓    |
| Çıkıştan sonra eski çerezle istek                                    | 401                               | ✓    |

**Oturum:** Rastgele 256 bit token, HttpOnly + Secure + SameSite=Strict çerezde. Redis'te token'ın kendisi değil SHA-256 özeti tutulur. Süre 8 saat. Yanıtlarda `Cache-Control: no-store`.

**Loglar:** Reddedilen token'ın sebebi loglanır (`replayed`, `unsupported_alg` gibi), token'ın kendisi asla.

**Bilinen açık konular (Onur'un incelemesi bekleniyor):**

- Token, platformdan web uygulamasına URL fragment'ı (`#token=`) ile geçiyor. Fragment sunucuya ve loglara gitmez, sayfa açılır açılmaz adres çubuğundan silinir; ama tarayıcı eklentileri ve sayfadaki JavaScript görebilir. Tek kullanım ve 5 dakika ömür bu riski sınırlıyor. Alternatif: platformun token'ı POST ile göndermesi.
- `SameSite=Strict` çerezin iOS/Android WebView'larda davranışı gerçek cihazda test edilmeli.
- Giriş sınırı IP başına. Aynı NAT arkasındaki çok sayıda kullanıcı (mobil operatör) etkilenebilir; üretimde tenant + IP bazlı olmalı.
- `trustProxy` kapalı; üretimde yük dengeleyici arkasında gerçek istemci IP'si için ayarlanmalı.

## Fiyat akışı ve ligler: uygulama ayrıntısı (Faz 1)

**Kod:** `apps/api/src/prices/`, `apps/api/src/leagues/`. **Testler:** birim ve uç testleri + `*.int.test.ts` (gerçek PostgreSQL ve Redis).

| Saldırı ya da hata                                           | Sonuç                                                     | Test |
| ------------------------------------------------------------ | --------------------------------------------------------- | ---- |
| Akışta lig varlığı olmayan sembol                            | Saklanmaz                                                 | ✓    |
| Sıfır, negatif, bilimsel gösterimli ya da bozuk fiyat        | O fiyat atlanır, diğerleri saklanır                       | ✓    |
| Gelecek zaman damgalı fiyat (2 sn toleransın dışında)        | Saklanmaz                                                 | ✓    |
| Eski fiyatı tekrar gönderme / geç gelen eski fiyat           | Son fiyat geriye gitmez (Redis içinde tek adımda kontrol) | ✓    |
| Akış kesilirse                                               | 5 sn sonra fiyat "bayat" işaretlenir, tek uyarı logu      | ✓    |
| Akış adresinden iç adrese yönlendirme (169.254.169.254 gibi) | Reddedilir                                                | ✓    |
| `file:`, `gopher:` adresleri, adreste kullanıcı adı/parola   | Reddedilir                                                | ✓    |
| Yavaş ya da çok büyük yanıt                                  | 2 sn / 256 KB'de kesilir                                  | ✓    |
| Başka platformun ligini listeleme, açma ya da katılma        | Listede yok; açma ve katılma 404, "yok" ile aynı yanıt    | ✓    |
| Taslak ya da arkadaş ligine katılma                          | 404                                                       | ✓    |
| Bitmiş lige katılma                                          | 409 `LEAGUE_NOT_ACTIVE`                                   | ✓    |
| Aynı katılma isteğini 20 kez paralel gönderme                | Tek üyelik, tek bakiye                                    | ✓    |
| Katılırken gövdede bakiye gönderme                           | Yok sayılır; bakiye her zaman ligin başlangıç tutarı      | ✓    |
| Yönetici ligi kapattıktan hemen sonra katılma (eski okuma)   | Koşul yazma anında kontrol edilir, reddedilir             | ✓    |
| Adres çubuğundan lig kimliği yerine yol (`../auth/logout`)   | Web tarafında kodlanır; API 400                           | ✓    |

**Bilinen açık konular:**

- Fiyat akışının kimliği şimdilik yalnızca adres ve TLS'e dayanıyor. Gerçek platformla entegrasyonda istek imzası ya da API anahtarı eklenmeli.

## Emir motoru ve portföy: uygulama ayrıntısı (Faz 1)

**Kod:** `apps/api/src/orders/`. **Testler:** `orders.e2e.test.ts` (activity diyagramının her dalı), `order-math.test.ts`, `orders.int.test.ts` (gerçek PostgreSQL ve Redis).

| Saldırı ya da hata                                               | Sonuç                                                                 | Test |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- | ---- |
| Gövdede fiyat ya da miktar gönderme                              | 400; fiyat her zaman sunucuda Redis'ten okunur                        | ✓    |
| 5 sn'den eski fiyatla emir (fiyat akışı dururken)                | 409 `PRICE_STALE`                                                     | ✓    |
| Aynı anda 20 alım emriyle bakiyeden fazla harcama                | Tam olarak bakiye kadarı gerçekleşir, bakiye 0,00, eksiye düşmez      | ✓    |
| Aynı pozisyonu paralel "tümünü sat" ile iki kez satma            | Tek satış                                                             | ✓    |
| Aynı emri (aynı idempotency anahtarı) 10 kez paralel gönderme    | Tek emir, diğerleri 200 ile aynı sonucu alır                          | ✓    |
| Aynı anahtarla farklı emir                                       | 409 `IDEMPOTENCY_KEY_REUSED`                                          | ✓    |
| Küçük al-sat döngüleriyle yuvarlamadan para üretme               | Yuvarlama hep kasanın lehine; 2.000 rastgele senaryoda bakiye artmadı | ✓    |
| Bakiyeden 1 kuruş fazla alım                                     | 422 `INSUFFICIENT_CASH`                                               | ✓    |
| Elindekinden fazla satış                                         | 422 `NO_POSITION`                                                     | ✓    |
| Ligde olmayan ya da başka platformun varlığıyla işlem            | 422 `ASSET_NOT_IN_LEAGUE`                                             | ✓    |
| Başlamamış, süresi dolmuş ya da kapatılmış ligde işlem           | 409 `LEAGUE_NOT_ACTIVE`                                               | ✓    |
| Üye olmadan ya da başka platformun liginde işlem / portföy görme | 403 `NOT_A_MEMBER` / 404                                              | ✓    |
| Emir kaydı sırasında veritabanı hatası                           | Bakiye ve pozisyon değişikliği geri alınır                            | ✓    |
| Kodda hata olsa bile eksi bakiye ya da sıfır pozisyon            | Veritabanı CHECK kısıtı reddeder                                      | ✓    |
| Dakikada 30'dan fazla emir (oyuncu başına)                       | 429 + `Retry-After`                                                   | ✓    |

**Nasıl:** Emir tek transaction'da işlenir. Önce lig paylaşımlı kilitle (`FOR SHARE`), sonra üyelik özel kilitle (`FOR UPDATE`) okunur; aynı oyuncunun aynı ligdeki emirleri sıraya girer, farklı oyuncular birbirini beklemez. Kilit sırası her yerde aynı (önce lig, sonra üyelik), kilitlenme (deadlock) olmaz. Hesaplar BigInt ile tam sayı kuruş/birim üzerinden yapılır (K-009).

**Bilinen açık konular:**

- Dakikada 30 emir sınırı oyuncu başına. Bir platformun bütün oyuncularının toplam yükü için tenant bazlı sınır Faz 4'te.
- Doğrulama hatası mesajı birleşik şemalarda (al / tutarla sat / tümünü sat) alan adı yerine "body" diyebiliyor. Güvenlik sorunu değil, mesaj iyileştirmesi.
