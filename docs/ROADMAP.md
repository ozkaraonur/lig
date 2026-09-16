# Yol haritası

Durum: `[x]` bitti · `[ ]` yapılacak. Parantezdeki kodlar tasarım dosyasındaki gereksinimlerdir.

## Faz 0 · Kurulum

- [x] Monorepo: `apps/api`, `apps/web`, `apps/mock-platform`, `packages/shared`
- [x] TypeScript, ESLint, Prettier, Vitest
- [x] Docker Compose: PostgreSQL + Redis
- [x] CI: format, lint, typecheck, test, build, migration kontrolü, secret taraması, bağımlılık denetimi
- [x] Veritabanı şeması ve ilk migration
- [x] API sağlık kontrolü, güvenlik başlıkları, ortam değişkeni doğrulaması
- [ ] Tehdit modeli (Onur)

## Faz 1 · Çekirdek, oyuncu tarafı

- [ ] Sahte platform: JWT imzalama, fiyat akışı, gerçek işlem webhook'u
- [ ] Giriş: token doğrulama, oyuncu oluşturma, oturum (FR-01)
- [ ] Fiyat alıcı + Redis'te son fiyat (FR-30)
- [ ] Lig listeleme, katılma, sanal bakiye (FR-02, FR-03)
- [ ] Emir motoru: kurallar, idempotency, transaction, her hata dalına test (FR-04, FR-33)
- [ ] Portföy ve getiri (FR-05)
- [ ] Haftalık ve sezon sıralaması (FR-06)
- [ ] Görevler ve XP, BullMQ worker (FR-07)
- [ ] Lig kapanışı ve ödül dağıtımı (FR-32)
- [ ] Oyuncu arayüzü (FR-08 dahil)

## Faz 2 · Yönetim paneli

- [ ] Yönetici girişi: e-posta, parola, MFA
- [ ] Lig oluşturma ve düzenleme (FR-20)
- [ ] Görev şablonları (FR-21)
- [ ] Marka ayarları (FR-22)
- [ ] Metrikler (FR-23, FR-31)
- [ ] Kilitli uyum ayarları (FR-24)
- [ ] Değiştirilemez denetim kaydı (NFR-07)

## Faz 3 · Tam sürüm özellikleri

- [ ] Arkadaş ligi ve davet kodu (FR-09)
- [ ] Rozetler (FR-10)
- [ ] AI koç: davranış analizi, LLM, al/sat filtresi, yanıt kaydı (FR-11)
- [ ] CSV dışa aktarma (FR-25)

## Faz 4 · Sağlamlaştırma ve yayın

- [ ] Satır düzeyinde erişim kontrolü (PostgreSQL RLS)
- [ ] Yük testi: 10.000 oyuncu, p95 < 300 ms (NFR-01)
- [ ] Güvenlik testi, OWASP ASVS L2 kontrol listesi (NFR-03)
- [ ] AWS: dev/staging/prod, Terraform, izleme ve loglar
- [ ] Native SDK sarmalayıcı (opsiyonel)
