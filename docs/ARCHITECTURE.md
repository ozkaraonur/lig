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

## Veri

- Şema: `apps/api/src/db/schema.ts`. Migration'lar: `apps/api/drizzle/` (düz SQL, review edilir).
- Şema değişince `npm run db:generate`; CI şema ile migration'ların uyumlu olduğunu kontrol eder.
- Para ve miktar `numeric`; JavaScript `number`'a çevrilmez, string olarak taşınır.
- Kök tablolar `tenant_id` taşır. Her sorgu tenant ile sınırlanır (NFR-03).
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
