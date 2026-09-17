# Mimari

Bu dosya kodu ilk kez açan birinin (ya da yeni bir Claude oturumunun) projeyi hızla kavraması içindir. Kod değiştikçe güncel tutulur.

## Ürün tek cümlede

Müşteri platformunun mobil uygulaması içinde WebView olarak açılan lig modülü: oyuncu sanal parayla lige katılır, işlem yapar, sıralamada yarışır; platform yöneticisi bunun gerçek işleme geçişe etkisini ölçer.

## Bileşenler

| Bileşen              | Teknoloji                                          | Sorumluluk                                                                  |
| -------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/api`           | NestJS 11, Fastify, Drizzle ORM, PostgreSQL, Redis | İş kuralları, emir motoru, sıralama, görevler, yönetim API'si               |
| `apps/web`           | Next.js 16, React 19                               | Oyuncu ekranları (`/`) ve yönetim paneli (`/admin`)                         |
| `apps/mock-platform` | Fastify                                            | Gerçek platformun yerine geçer: token imzalar, fiyat yayınlar, webhook atar |
| `packages/shared`    | TypeScript, zod                                    | API ve istemcilerin paylaştığı tipler, hata kodları, şemalar                |

Tek repo, modüler yapı (bkz. DECISIONS.md, K-001). API içindeki modüller birbirine yalnızca dışa açtıkları servisler üzerinden erişir; ileride bir modül ayrı servise çıkarılabilir.

## Platform ile entegrasyon (3 bağlantı)

1. **Giriş:** Platform, oyuncu için RS256 imzalı, en fazla 5 dk geçerli JWT üretir. API platformun açık anahtarıyla doğrular (FR-01).
2. **Fiyat akışı:** Platform fiyatlarını bir HTTP ucunda yayınlar; API saniyede bir okur, son fiyatı zaman damgasıyla Redis'te tutar (FR-30).
3. **Gerçek işlem olayı:** Platform webhook ile bildirir; `external_event_id` tekrar oynatmayı engeller (FR-31).

## Oyuncu girişi (FR-01)

1. Oyuncu platform uygulamasında Ligler'e dokunur. Platform RS256 ile imzalı, 5 dakikalık, `jti`'li bir token üretir.
2. Platform, modülü `WEB/auth/callback#token=...` adresiyle açar. Sayfa token'ı adres çubuğundan siler.
3. Web, token'ı `POST /auth/session` ile API'ye gönderir.
4. API: giriş denemesi sınırı → `iss` ile tenant bulma → imza ve claim doğrulama → `jti` tek kullanım (Redis) → oyuncuyu oluşturma/güncelleme → oturum.
5. API, HttpOnly + Secure + SameSite=Strict `lig_session` çerezini döner. Sonraki bütün istekler bu çerezle yapılır.

Kod: `apps/api/src/auth/`. Dış bağımlılıklar (`ports.ts`) arayüz olarak tanımlı; testlerde bellek içi sahteleri kullanılır.

## Fiyat akışı (FR-30)

1. `PriceIngestWorker` saniyede bir (`PRICE_POLL_INTERVAL_MS`) fiyat adresi olan her tenant'ın ucunu okur. Kaynak listesi 30 sn'de bir yenilenir. Bir tur bitmeden yenisi başlamaz.
2. `HttpPriceFeedClient`: yönlendirme yok, 2 sn zaman aşımı, 256 KB sınırı, üretimde yalnızca https.
3. `PriceIngestService`: her fiyat ayrı doğrulanır; lig varlığı olmayan, gelecekten gelen ya da zaten bayat fiyat atlanır.
4. `RedisPriceStore`: `price:{tenantId}:{symbol}` = `{"p": "fiyat", "t": ms}`. Lua betiği yalnızca daha yeni fiyatı yazar. 10 dk saklanır.
5. `PriceService.latestFor`: diğer modüller fiyatı buradan okur; 5 sn'den eski fiyat `stale: true`.

İşler `WORKERS_ENABLED=true` olan süreçte çalışır (K-007).

## Ligler (FR-02, FR-03)

| Uç                        | Ne yapar                                                                    |
| ------------------------- | --------------------------------------------------------------------------- |
| `GET /leagues`            | Oyuncunun platformundaki ligler: süren, başlayacak, son 30 günde biten      |
| `GET /leagues/:id`        | Lig, varlıklar ve son fiyatlar, oyuncunun üyeliği ve bakiyesi               |
| `GET /leagues/:id/prices` | Sadece son fiyatlar (ekran 2 sn'de bir yeniler)                             |
| `POST /leagues/:id/join`  | Katılır, başlangıç bakiyesini verir. İlk seferde 201, sonra 200 aynı üyelik |

- Lig durumu (`status`) yöneticinin kararıdır: `draft`, `active`, `finished`. Oyuncunun gördüğü evre (`phase`) tarihlerden hesaplanır: `upcoming`, `running`, `ended`.
- Taslak, arkadaş ligi (Faz 3) ve başka platformun ligi oyuncuya görünmez; hepsi aynı 404'ü alır.
- Katılma koşulları ve kayıt tek SQL cümlesinde (`INSERT ... SELECT ... ON CONFLICT DO NOTHING`): kontrol ile yazma arasında lig kapanamaz, paralel istek iki üyelik açamaz.

## Emir motoru (FR-04, FR-33)

`POST /leagues/:id/orders` gövdesi: `{ assetId, side: "buy", amount }`, `{ assetId, side: "sell", amount }` ya da `{ assetId, side: "sell", all: true }`, hepsinde `idempotencyKey` (UUID). Fiyat ve miktar gövdede yok.

Sıra (tek transaction, K-010):

1. Lig görünür mü? (`FOR SHARE`) Değilse 404.
2. Oyuncu üye mi? (`FOR UPDATE`) Değilse 403 `NOT_A_MEMBER`.
3. Bu anahtarla emir var mı? Aynı istekse önceki sonuç (200), farklıysa 409 `IDEMPOTENCY_KEY_REUSED`.
4. Lig işlemde mi (`active` ve başlangıç ≤ şimdi < bitiş)? Değilse 409 `LEAGUE_NOT_ACTIVE`.
5. Varlık ligde ve tenant'ın mı? Değilse 422 `ASSET_NOT_IN_LEAGUE`.
6. Fiyat 5 sn'den taze mi? Değilse 409 `PRICE_STALE` + `Retry-After: 2`.
7. Alış: bakiye yeterli mi (422 `INSUFFICIENT_CASH`), miktar sıfır değil mi (422 `ORDER_TOO_SMALL`). Satış: pozisyon yeterli mi (422 `NO_POSITION`).
8. Bakiye, pozisyon (ortalama maliyet) ve emir kaydı yazılır. Yeni emirde 201.

Hesaplar BigInt ile (K-009). Pozisyon miktarı sıfıra inerse satır silinir.

## Portföy (FR-05)

- `GET /leagues/:id/portfolio`: nakit, pozisyonlar (son fiyatla değer, kâr/zarar, yüzde), toplam değer, başlangıca göre getiri. Fiyat bayatsa son bilinen fiyat, hiç yoksa maliyet kullanılır.
- `GET /leagues/:id/orders?limit=50`: son emirler, en yeni önce (en fazla 100).

## İstek sınırları (T9)

Oyuncu başına, IP'ye değil (`auth/player-rate-limit.guard.ts`): lig okumaları dakikada 120, katılma 10, emir 30. Giriş denemesi IP başına dakikada 20.

## Veri

- Şema: `apps/api/src/db/schema.ts`. Migration'lar: `apps/api/drizzle/` (düz SQL, review edilir).
- Şema değişince `npm run db:generate`; CI şema ile migration'ların uyumlu olduğunu kontrol eder.
- Para ve miktar `numeric`; JavaScript `number`'a çevrilmez, string olarak taşınır.
- Kök tablolar `tenant_id` taşır. Her sorgu tenant ile sınırlanır (NFR-03).
- Tenant silme sırası: önce o tenant'ın ligleri (üyelik, pozisyon, emir cascade ile gider), sonra tenant. Pozisyonu olan varlık `restrict` ile korunduğu için doğrudan tenant silmek hata verir.
- Anlık fiyat Redis'te: `price:{tenantId}:{symbol}`. Sıralama da Redis'te olacak: `league:{id}:ranking` (sorted set).

## Kod kuralları

- Kod, değişken ve tablo adları İngilizce; dokümanlar, commit açıklamaları ve kullanıcıya dönen metinler Türkçe.
- Her dış girdi zod ile doğrulanır. Hata yanıtları `@lig/shared` içindeki `ERROR_CODES` ile döner; stack ya da SQL istemciye gitmez.
- Log'a secret, token, parola, bağlantı dizesi ya da kişisel veri yazılmaz.
- Yeni davranış testle gelir. Emir motorunda activity diyagramındaki her hata dalı için test yazılır.
- Veritabanı ve Redis kodu ayrıca gerçek servislere karşı `*.int.test.ts` ile test edilir (K-008). Ham SQL'de tablo adları açıkça yazılır.
- Gereksinim kodları (FR-xx, NFR-xx) commit, PR ve test açıklamalarında referans verilir.

## Nerede ne var

- Gereksinimler ve diyagramlar: Claude'daki "Lig Modülü Tasarım Dosyası"
- Fazlar ve durum: `docs/ROADMAP.md`
- Kararların gerekçeleri: `docs/DECISIONS.md`
