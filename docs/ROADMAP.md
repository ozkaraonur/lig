# Yol haritası

Durum: `[x]` bitti · `[ ]` yapılacak. Parantezdeki kodlar tasarım dosyasındaki gereksinimlerdir.

## Faz 0 · Kurulum

- [x] Monorepo: `apps/api`, `apps/web`, `apps/mock-platform`, `packages/shared`
- [x] TypeScript, ESLint, Prettier, Vitest
- [x] Docker Compose: PostgreSQL + Redis
- [x] CI: format, lint, typecheck, test, build, migration kontrolü, secret taraması, bağımlılık denetimi
- [x] Veritabanı şeması ve ilk migration
- [x] API sağlık kontrolü, güvenlik başlıkları, ortam değişkeni doğrulaması
- [x] Tehdit modeli taslağı
- [ ] Tehdit modeli: giriş sistemi incelemesi (Onur)

## Faz 1 · Çekirdek, oyuncu tarafı

- [x] Sahte platform: oyuncu token'ı imzalama, giriş sayfası
- [x] Giriş: token doğrulama, oyuncu oluşturma, oturum çerezi, çıkış, giriş denemesi sınırı (FR-01, T1)
- [x] Sahte platform: fiyat akışı (FR-30)
- [x] Sahte platform: gerçek işlem ekranı ve imzalı webhook (FR-31)
- [x] Webhook alıcı: HMAC imzası, zaman penceresi, olay tekilliği (FR-31, T5)
- [x] Fiyat alıcı + Redis'te son fiyat (FR-30)
- [x] Lig listeleme, katılma, sanal bakiye (FR-02, FR-03)
- [x] Gerçek PostgreSQL ve Redis ile entegrasyon testleri, CI'da
- [x] Emir motoru: kurallar, idempotency, transaction, her hata dalına test (FR-04, FR-33)
- [x] Oyuncu başına istek sınırı: emir ve lig uçları (T9)
- [x] Portföy, getiri ve emir geçmişi (FR-05)
- [x] Haftalık ve sezon sıralaması (FR-06)
- [x] Görevler ve XP, PostgreSQL outbox worker (FR-07, K-013)
- [x] Lig kapanışı ve XP ödülleri (FR-32)
- [x] Altyapı ön kontrolü (`db:migrate`, `test:int`), fastify güvenlik güncellemesi
- [x] Oyuncu arayüzü: lig listesi, katılma, işlem paneli, portföy, sıralama, görevler, XP, "Gerçek hesabıma geç" (FR-08)

## Faz 2 · Yönetim paneli ve BIST

- [ ] Yönetici girişi: e-posta, parola, MFA
- [ ] Lig oluşturma ve düzenleme (FR-20)
- [ ] Görev şablonları (FR-21)
- [ ] Marka ayarları (FR-22)
- [ ] Metrikler (FR-23, FR-31)
- [ ] Kilitli uyum ayarları (FR-24)
- [ ] Değiştirilemez denetim kaydı (NFR-07)
- [ ] İkinci sahte müşteri: "Sahte Aracı Kurum", BIST hisseleri (sahte fiyat), açık tema
- [ ] Seans saati kuralı: hisse varlıklarında seans dışında emir verilmez
- [ ] Demo için gerçek kripto fiyat modu (kullanım şartları uygun, herkese açık bir borsa fiyat ucu)
- [ ] ESLint 10, Vitest 4+ ve drizzle-kit ana sürüm yükseltmeleri (K-012)

## Faz 3 · Tam sürüm özellikleri

- [ ] Arkadaş ligi ve davet kodu (FR-09)
- [ ] Rozetler (FR-10)
- [ ] AI koç: davranış analizi, LLM, al/sat filtresi, yanıt kaydı (FR-11)
- [ ] CSV dışa aktarma (FR-25)

## Faz 3.5 · Pilot entegrasyonu

İlk pilot müşteriyle başlar. Sahte platformun yerine gerçek platform bağlanır; sahte platform testlerde kalır.

- [ ] Gerçek fiyat akışı (FR-30): platformun fiyat ucu ya da lisanslı veri sağlayıcı (BIST lisans sorusu cevaplanmış olmalı)
- [ ] Gerçek giriş: platformun imzaladığı oyuncu token'ı, anahtar değişim (rotasyon) süreci (FR-01)
- [ ] Gerçek webhook: platformun işlem olayları, anahtar rotasyonu (FR-31)
- [ ] WebView içinde gerçek cihaz testi: iOS ve Android, çerez davranışı (NFR-08)
- [ ] Veri konumu kararı: Türkiye'de barındırma gerekiyor mu (NFR-05)

## Faz 4 · Sağlamlaştırma ve yayın

- [ ] Satır düzeyinde erişim kontrolü (PostgreSQL RLS)
- [ ] Yük testi: 10.000 oyuncu, p95 < 300 ms (NFR-01)
- [ ] Güvenlik testi, OWASP ASVS L2 kontrol listesi (NFR-03)
- [ ] AWS: dev/staging/prod, Terraform, izleme ve loglar
- [ ] Webhook ve SSO anahtarlarının KMS ile şifreli saklanması
- [ ] Native SDK sarmalayıcı (opsiyonel)
