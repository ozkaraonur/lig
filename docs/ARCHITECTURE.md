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
3. **Gerçek işlem olayı:** Platform HMAC ile imzalı webhook gönderir (`POST /webhooks/platform`); zaman damgası penceresi ve `external_event_id` tekrar oynatmayı engeller (FR-31, K-014).

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

## Sıralama (FR-06) ve lig kapanışı (FR-32)

`LeagueSchedulerWorker` 2 sn'de bir (`RANKING_INTERVAL_MS`):

1. Süresi dolmuş ama kapanmamış ligleri kapatır (`LeagueCloseService`): lig `FOR UPDATE`, pozisyonlar son fiyatlarla değerlenir, `memberships.final_rank / final_value` ve `leagues.closing_prices` yazılır, XP `xp_ledger`'a işlenip `players.xp`'ye eklenir, lig `finished` olur, Redis sıralaması silinir.
2. Süren liglerin sıralamasını yeniden hesaplayıp Redis'e yazar: `league:{id}:ranking` (sorted set, skor = kuruş).

`GET /leagues/:id/leaderboard?limit=5`: süren ligde Redis'ten, kapanmış ligde PostgreSQL'den. İlk N oyuncu ve oyuncunun kendi satırı; kapanmış ligde kazandığı XP. Ödül kuralları: K-011.

Kapanmış ligin portföy ekranı kapanış fiyatlarıyla değerlenir; final sıralamasıyla aynı değeri gösterir.

## Görevler ve XP (FR-07)

- Şablonlar: `join_league`, `place_orders`, `trade_distinct_assets`, `real_trade`. Dönem: `once` ya da `weekly` (pazartesi 00:00 TR, anahtar `2026-W38`).
- Emir, katılma ve platform olayı aynı transaction'da `outbox_events`'e yazılır. `OutboxWorker` saniyede bir alır (`FOR UPDATE SKIP LOCKED`), oyuncunun görevlerini değerlendirir (K-013).
- İlerleme kaynak veriden sayılır; hedefe ulaşınca `quest_progress.completed_at` ve `xp_ledger` (kaynak = `görevId:dönem`).
- `GET /quests`: güncel dönem, anlık ilerleme, tamamlanma ve yenilenme zamanı. `GET /auth/me`: toplam XP ve platform bilgisi.

## Webhook (FR-31) ve "Gerçek hesabıma geç" (FR-08)

1. Oyuncu lig ekranında "Gerçek hesabıma geç"e dokunur; `tenants.real_trade_url` (yalnızca http/https) açılır.
2. Platformda işlem yapılır, platform imzalı webhook gönderir: `x-lig-issuer`, `x-lig-timestamp`, `x-lig-signature: v1=HMAC-SHA256(anahtar, "ts.gövde")`.
3. API: issuer → tenant, zaman penceresi ±5 dk, sabit sürede imza karşılaştırma, sonra gövde doğrulama. `platform_events` (tenant + olay kimliği tekil) ve oyuncu biliniyorsa outbox olayı aynı transaction'da.
4. Ligi hiç açmamış kullanıcının olayı da `external_player_id` ile tutulur: Faz 2 metriklerinde (FR-23) oynayan ve oynamayan kullanıcılar karşılaştırılır.

Sahte platformda: `http://localhost:4100/trade` (gerçek işlem ve "son bildirimi tekrar gönder").

## Yönetici girişi (T6, K-016)

1. `POST /admin/auth/login` (e-posta, parola). Deneme sınırları, argon2id doğrulama. Doğruysa 10 dk'lık giriş adımı çerezi (`lig_admin_preauth`, yol `/admin/auth`) ve sonraki adım: `mfa_setup` ya da `mfa_verify`.
2. İlk girişte `POST /admin/auth/mfa/setup`: TOTP secret'ı üretilir, şifreli olarak giriş adımına yazılır, QR içeriği döner. Web QR'ı tarayıcıda çizer.
3. `POST /admin/auth/mfa/verify` (6 haneli kod). Doğruysa giriş adımı silinir, `lig_admin_session` çerezi (yol `/admin`) ile yeni oturum açılır. İlk girişte secret bu anda veritabanına geçer.
4. Yönetici uçları `AdminSessionGuard` ile korunur: oturum Redis'te (token özetiyle), 30 dk hareketsizlik ve 8 saat mutlak süre; hesap, rol ve MFA durumu her istekte veritabanından. Rol kısıtı `@AdminRoles('owner')`.

Web: `/admin/login`, `/admin/mfa/setup`, `/admin/mfa`, `/admin`. Hesap açma ve MFA sıfırlama şimdilik komut satırından: `npm run admin:create`, `npm run admin:reset-mfa`.

## Denetim kaydı (NFR-07, K-019)

`audit_events`: yalnızca eklenebilir (tetikleyici), platform başına SHA-256 özet zinciri. Yazma `recordAudit(tx, entry)` ile değişikliğin transaction'ı içinde; tek başına olaylar (giriş denemeleri) `AuditLog.append` ile. Okuma: `GET /admin/audit` (sayfalı), `GET /admin/audit/verify`; komut satırı `npm run audit:verify`.

## Ekip ve hesap (K-020)

- Sahip: `GET /admin/team`, `POST /admin/team/invites`, `DELETE /admin/team/invites/:id`, `PATCH /admin/team/:id/role`, `POST /admin/team/:id/mfa-reset`, `DELETE /admin/team/:id`.
- Davetli (oturumsuz): `POST /admin/invites/lookup`, `POST /admin/invites/accept`. Link: `/admin/invite#token=...`.
- Her yönetici: `POST /admin/account/password`, `POST /admin/account/sessions/revoke-others`.
- Oturum geçersizleştirme `admin_users.session_version` ile: sürüm artınca o yöneticinin bütün oturumları düşer.

Web: `/admin` (panel), `/admin/team`, `/admin/audit`, `/admin/account`, `/admin/invite`.

## Lig yönetimi (FR-20, K-021) ve uyum ayarları (FR-24, K-022)

- `GET /admin/leagues`, `GET /admin/leagues/assets`, `GET /admin/leagues/:id`: her rol.
- `POST /admin/leagues`, `PATCH /admin/leagues/:id`, `DELETE /admin/leagues/:id`: sahip ve düzenleyici. Hangi alanın değişebileceği `leagueEditability` ile belirlenir ve yanıtta `editable` olarak döner.
- Katılım koşulları `leagues.max_members` ve `leagues.late_join_allowed`; katılım SQL'inde uygulanır, lig başına danışma kilidiyle.
- `GET /admin/compliance`: her rol. `PATCH /admin/compliance`: sahip; yalnızca `realTradeButton` ve `realTradeQuest`. Kilitli ayarlar `LOCKED_COMPLIANCE_SETTINGS` sabitinde.

Web: `/admin/leagues`, `/admin/leagues/new`, `/admin/leagues/[id]`, `/admin/compliance`. Oyuncu ekranlarında kilitli sanal para uyarısı.

## Görev şablonları (FR-21, K-023) ve marka ayarları (FR-22, K-024)

- `GET /admin/quests`: her rol. `POST /admin/quests`, `PATCH /admin/quests/:id`, `DELETE /admin/quests/:id`: sahip ve düzenleyici.
- Yönetici şablon, dönem, hedef ve XP seçer; başlık şablondan üretilir (`questTitle`). Şablon ve dönem sonradan değişmez.
- `(tenant_id, template, period)` tekil; ikinci görev 409. XP dağıtmış görev (`xp_ledger`'da kaydı olan) silinmez, yalnızca pasife alınır.
- `GET /admin/branding`: her rol. `PATCH /admin/branding`: sahip ve düzenleyici. Ad `tenants.name`, renk ve logo `tenants.theme` jsonb alanında.
- Oyuncu ekranı rengi `/auth/me` ile gelir. `BrandingStyle` üç CSS değişkeni yazar: `--accent` (marka rengi), `--accent-text` (rengin üstündeki yazı), `--accent-readable` (koyu zeminde marka rengiyle yazılan yazı; kontrast 4.5:1 olana kadar açılır). İkisi de `@lig/shared` içindeki saf fonksiyonlarla hesaplanır.
- Logo yalnızca `https://`; sunucu doğrular, oyuncuya başka bir şey gitmez.

Web: `/admin/quests` (tabloda hedef ve XP satır içi düzenlenir), `/admin/branding` (renk seçici ve önizleme).

## Pay piyasası: seans ve fiyat limitleri (K-027)

- Kurallar `@lig/shared` içindeki saf fonksiyonlarda: `marketStatus`, `sessionsOn`, `lastSessionClose`, `clampToLimits`. Seans hafta içi 10:00-13:00 ve 14:00-18:00 (TR), bayram arifesinde yalnızca sabah; tatil listesi `MARKET_HOLIDAYS`.
- Emir: hisse varlığında seans kapalıysa 409 `MARKET_CLOSED`. Kripto varlıklar etkilenmez.
- Fiyat akışı: seans kapalıyken hisse fiyatı saklanmaz (`market_closed` sayacı), açıkken fiyat tavan/taban aralığına çekilir. Limit `assets.reference_close` (önceki kapanış) ±%10.
- Kapanış: `MarketCloseService` seans bittikten sonra o günün son fiyatlarını `reference_close` ve `reference_close_date` alanlarına yazar. Fiyat akışı turuyla birlikte çalışır, ayrı worker yok.
- `GET /leagues/:id/prices` hisse varlığı olan ligde `market` alanını da döner; oyuncu ekranı seans durumunu sunucudan alır, kendi saatine bakmaz.

## Demo için gerçek fiyat modu (K-028)

Sahte platform `MOCK_PLATFORM_PRICE_MODE=real` ile halka açık bir borsa ticker ucundan TL paritelerini okur ve kendi `/prices` ucunda bizim tick şemamızda yayınlar; lig API'si tarafında hiçbir şey değişmez. Varsayılan kapalıdır. Zaman damgası okuma anımızdır, kaynak susarsa son fiyat tazelenmeden yayınlanır (5 sn sonra bayat sayılır), hiç fiyat gelmediyse simülasyona düşülür. Mod ve son okuma zamanı sahte platform sayfasında ve `GET /debug/prices` yanıtında görünür.

## İki sahte müşteri (Faz 2, 7. adım)

`apps/mock-platform` aynı süreçte iki müşteriyi taklit eder: kripto borsası (4100, issuer `mock-platform`, koyu tema) ve aracı kurum (4200, issuer `mock-broker`, BIST hisseleri, açık tema). Her birinin kendi anahtar çifti (`keys/`, `keys-broker/`), webhook anahtarı ve tenant kaydı vardır. `npm run db:seed` ikisini de kurar.

## Metrikler (FR-23, K-025)

- `GET /admin/metrics?days=7|30|90`: her rol. Sayılar canlı sorgulanır, özet tablosu yok.
- Toplamlar: oyuncu, aktif oyuncu (dönemde katılan ya da emir veren), katılma, emir, tamamlanan görev, dağıtılan XP, "gerçek hesabıma geç" dokunuşu (toplam ve farklı oyuncu), gerçek işlem bildirimi, açılan hesap.
- Gerçek işlem yapan kullanıcılar üçe ayrılır: lige katılmış, modülü açmış ama katılmamış, modülü hiç açmamış (`platform_events.player_id` boş).
- Lig tablosu: üye, dönemdeki emir ve o ligden gelen dokunuş; en yeni 50 lig.
- `POST /real-trade/click`: oyuncu "Gerçek hesabıma geç"e dokunduğunda çağrılır, 204 döner. Gövdede yalnızca lig kimliği olabilir ve üyelik sunucuda doğrulanır. Oyuncu başına dakikada 20 istek.

Web: `/admin/metrics`. Oyuncu tarafında bağlantı `keepalive` ile sayımı gönderir, yanıtı beklemez.

## Gizli değerler (K-015)

Webhook anahtarı (`tenants.webhook_secret_ciphertext`) ve MFA secret'ı (`admin_users.mfa_secret_ciphertext`) `SecretCipher` ile şifreli. Bugünkü uygulama AES-256-GCM, anahtar `SECRET_KEYS` ortam değişkeninden (üretimde zorunlu, geliştirmede boşsa herkesin bildiği geliştirme anahtarı). Her değer kendi satırına bağlıdır (`secretContext`). Yeni anahtar: `npm run secrets:new-key`; değişim: yeni anahtarı başa ekle, `npm run secrets:rotate`. Faz 3.5'te aynı arayüzün OpenBao uygulaması gelir.

## İstek gövdesi

Gövdeli her istek `application/json` olmak zorunda, değilse 415 (`app.setup.ts`). Başka sitedeki HTML formlarının CORS'a takılmadan istek atmasını engeller.

## İstek sınırları (T9)

Oyuncu başına, IP'ye değil (`auth/player-rate-limit.guard.ts`): lig okumaları dakikada 120, katılma 10, emir 30. Oyuncu girişi IP başına dakikada 20. Yönetici girişi: IP başına 15 dk'da 20, hesap başına 10, MFA kodu yönetici başına 5, giriş adımı başına 3.

## Veri

- Şema: `apps/api/src/db/schema.ts`. Migration'lar: `apps/api/drizzle/` (düz SQL, review edilir).
- Şema değişince `npm run db:generate`; CI şema ile migration'ların uyumlu olduğunu kontrol eder.
- Para ve miktar `numeric`; JavaScript `number`'a çevrilmez, string olarak taşınır.
- Kök tablolar `tenant_id` taşır. Her sorgu tenant ile sınırlanır (NFR-03).
- Tenant silme sırası: önce o tenant'ın ligleri (üyelik, pozisyon, emir cascade ile gider), sonra tenant. Pozisyonu olan varlık `restrict` ile korunduğu için doğrudan tenant silmek hata verir.
- Anlık fiyat Redis'te: `price:{tenantId}:{symbol}`. Süren ligin sıralaması Redis'te: `league:{id}:ranking` (sorted set).
- XP'nin her hareketi `xp_ledger`'da; (oyuncu, sebep, kaynak) tekil (NFR-07).

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
