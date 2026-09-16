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
2. **Fiyat akışı:** Platform fiyatları yayınlar; API son fiyatı zaman damgasıyla Redis'te tutar (FR-30).
3. **Gerçek işlem olayı:** Platform webhook ile bildirir; `external_event_id` tekrar oynatmayı engeller (FR-31).

## Oyuncu girişi (FR-01)

1. Oyuncu platform uygulamasında Ligler'e dokunur. Platform RS256 ile imzalı, 5 dakikalık, `jti`'li bir token üretir.
2. Platform, modülü `WEB/auth/callback#token=...` adresiyle açar. Sayfa token'ı adres çubuğundan siler.
3. Web, token'ı `POST /auth/session` ile API'ye gönderir.
4. API: giriş denemesi sınırı → `iss` ile tenant bulma → imza ve claim doğrulama → `jti` tek kullanım (Redis) → oyuncuyu oluşturma/güncelleme → oturum.
5. API, HttpOnly + Secure + SameSite=Strict `lig_session` çerezini döner. Sonraki bütün istekler bu çerezle yapılır.

Kod: `apps/api/src/auth/`. Dış bağımlılıklar (`ports.ts`) arayüz olarak tanımlı; testlerde bellek içi sahteleri kullanılır.

## Veri

- Şema: `apps/api/src/db/schema.ts`. Migration'lar: `apps/api/drizzle/` (düz SQL, review edilir).
- Şema değişince `npm run db:generate`; CI şema ile migration'ların uyumlu olduğunu kontrol eder.
- Para ve miktar `numeric`; JavaScript `number`'a çevrilmez, string olarak taşınır.
- Kök tablolar `tenant_id` taşır. Her sorgu tenant ile sınırlanır (NFR-03).
- Anlık fiyat ve sıralama Redis'te: `fiyat:{sembol}`, `lig:{id}:siralama` (sorted set).

## Kod kuralları

- Kod, değişken ve tablo adları İngilizce; dokümanlar, commit açıklamaları ve kullanıcıya dönen metinler Türkçe.
- Her dış girdi zod ile doğrulanır. Hata yanıtları `@lig/shared` içindeki `ERROR_CODES` ile döner; stack ya da SQL istemciye gitmez.
- Log'a secret, token, parola, bağlantı dizesi ya da kişisel veri yazılmaz.
- Yeni davranış testle gelir. Emir motorunda activity diyagramındaki her hata dalı için test yazılır.
- Gereksinim kodları (FR-xx, NFR-xx) commit, PR ve test açıklamalarında referans verilir.

## Nerede ne var

- Gereksinimler ve diyagramlar: Claude'daki "Lig Modülü Tasarım Dosyası"
- Fazlar ve durum: `docs/ROADMAP.md`
- Kararların gerekçeleri: `docs/DECISIONS.md`
