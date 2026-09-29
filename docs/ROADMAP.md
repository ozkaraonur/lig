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

Adım sırası: 1) şifreli anahtarlar ve yönetici girişi, 2) bağımlılık yükseltmeleri, 3) denetim kaydı ve yönetici yönetimi, 4) lig yönetimi ve uyum ayarları, 5) görev şablonları ve marka, 6) metrikler, 7) Sahte Aracı Kurum, 8) demo gerçek kripto fiyat modu.

- [x] Gizli değerlerin şifreli saklanması: webhook anahtarı ve MFA secret'ı, anahtar değişimi komutu (K-015)
- [x] Yönetici girişi: e-posta, argon2id parola, zorunlu TOTP MFA, ayrı oturum, deneme sınırları, rol kontrolü (K-016, T6)
- [x] ESLint 10, Vitest 4.1, drizzle-kit içindeki esbuild açığı; `npm audit` 0 uyarı (K-012)
- [x] Değiştirilemez denetim kaydı (NFR-07): tetikleyici, özet zinciri, `audit:verify`, panel ekranı (K-019)
- [x] Yönetici yönetimi: davet linki, rol değiştirme, MFA sıfırlama, kaldırma, parola değiştirme, diğer oturumları kapatma (K-020)
- [x] Lig oluşturma ve düzenleme: evreye göre kurallar, kontenjan ve geç katılım, yarış güvenliği (FR-20, K-021)
- [x] Kilitli uyum ayarları, oyuncu ekranında sanal para uyarısı, platformun açıp kapatabildiği ayarlar (FR-24, K-022)
- [x] Görev şablonları: hazır şablon, dönem, hedef ve XP; pasife alma, silme kuralı, eşzamanlı istek koruması (FR-21, K-023)
- [x] Marka ayarları: platform adı, ana renk, logo; yazı renkleri kontrasta göre hesaplanır (FR-22, K-024)
- [x] `check`/`dev` shared paketini önce derler (K-026)
- [x] Metrikler: dönüşüm hunisi, lig bazlı tablo, gerçek işlem yapanların lig modülüyle ilişkisi (FR-23, FR-31, K-025)
- [x] İkinci sahte müşteri: "Sahte Aracı Kurum", BIST hisseleri (sahte fiyat), sektör bilgisi, açık tema (K-027)
- [x] Seans saati kuralı: hisse varlıklarında seans dışında emir verilmez, fiyat son kapanışta donar (K-027)
- [x] Tavan/taban kuralı: BIST hisselerinde önceki kapanışa göre ±%10 (K-027)
- [x] Demo için gerçek kripto fiyat modu: sahte platform halka açık borsa ucundan TL paritelerini yayınlar, varsayılan kapalı (K-028)

## Faz 3 · Sosyal ve oyunlaştırma, tam sürüm özellikleri

Oyunlaştırma kapsamı K-017'de. Hiçbiri portföy değerini ya da sıralamayı değiştirmez; ödüller yalnızca XP ve görünüm (NFR-06).

- [ ] Kademe ligleri: Bronz, Gümüş, Altın, Platin, Efsane; ~50 kişilik gruplar, haftalık ilk %20 yükselir, son %20 düşer
- [ ] Günlük seri: günde en az bir işlem ya da ziyaret, 1 gün kaçırma hakkı, 7 günde XP ya da XP jokeri
- [ ] XP jokeri: bir hafta görev XP'si 2 kat
- [x] Yeni görev şablonları: çeşitlendirme ("3 farklı sektörden varlık al", K-029)
- [ ] Karşılıksız günlük tahmin: doğruysa az XP, yanlışsa kayıp yok, günde 1
- [ ] Rozetler, unvanlar ve profil çerçeveleri (FR-10), "Tavan Avcısı" dahil
- [ ] Arkadaş ligi ve davet kodu (FR-09)
- [ ] AI koç: davranış analizi, LLM, al/sat filtresi, yanıt kaydı (FR-11)
- [ ] CSV dışa aktarma (FR-25)

## Faz 3.5 · Pilot entegrasyonu

İlk pilot müşteriyle başlar. Sahte platformun yerine gerçek platform bağlanır; sahte platform testlerde kalır.

- [ ] Gerçek fiyat akışı (FR-30): platformun fiyat ucu ya da lisanslı veri sağlayıcı (BIST lisans sorusu cevaplanmış olmalı)
- [ ] Gerçek giriş: platformun imzaladığı oyuncu token'ı, anahtar değişim (rotasyon) süreci (FR-01)
- [ ] Gerçek webhook: platformun işlem olayları, anahtar rotasyonu (FR-31)
- [ ] Davet e-postası (K-020)
- [ ] Anahtar yönetimi: OpenBao Transit adaptörü, ana anahtar uygulama ortamından çıkar (K-015)
- [ ] Çoklu hesap: platformdan "kimliği doğrulanmış hesap" bilgisi; lig katılım koşulu olarak da kullanılır (K-018, K-021)
- [ ] WebView içinde gerçek cihaz testi: iOS ve Android, çerez davranışı (NFR-08)
- [ ] Veri konumu kararı: Türkiye'de barındırma gerekiyor mu (NFR-05). SPK'ya tabi kripto platformlarının birincil ve ikincil sistemleri yurt içinde olmalı; lig modülünün bu kapsama girip girmediği hukukçuya soruluyor

## Faz 4 · Sağlamlaştırma ve yayın

- [ ] Satır düzeyinde erişim kontrolü (PostgreSQL RLS)
- [ ] Veritabanı rolleri: uygulama tabloların sahibi olmayan rolle çalışır; denetim kaydına yalnızca INSERT/SELECT. Son özetin düzenli olarak dışarı yazılması (K-019)
- [ ] Yük testi: 10.000 oyuncu, p95 < 300 ms (NFR-01)
- [ ] Güvenlik testi, OWASP ASVS L2 kontrol listesi (NFR-03)
- [ ] Barındırma: dev/staging/prod, Terraform, izleme ve loglar. Sağlayıcı veri konumu kararına göre seçilir (Türkiye'deki bir veri merkezi, müşterinin kendi sunucusu ya da bulut)
- [ ] Motor genişletme: stop-loss emir türü, açığa satış, temettü; "Temettü Emeklisi" ve "Açığa Satış Üstadı" rozetleri
- [ ] Native SDK sarmalayıcı (opsiyonel)
