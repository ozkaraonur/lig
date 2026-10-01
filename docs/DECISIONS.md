# Mimari kararlar

Her karar: bağlam, karar, sonuç. Karar değişirse eskisi silinmez, "yerini aldı" diye işaretlenir.

## K-001 · Tek repo, modüler yapı

- **Bağlam:** İlk tasarımda web app, panel, API, kuyruk ve worker ayrı servislerdi. Geliştirici sayısı iki.
- **Karar:** Tek monorepo. API tek NestJS uygulaması, içeride net modüller. Arka plan işleri Redis üzerinde BullMQ ile. Oyuncu ekranları ve panel tek Next.js uygulaması.
- **Sonuç:** Daha az deploy ve izleme yükü. Modül sınırları korunduğu sürece bir modül sonradan ayrı servise çıkarılabilir.

## K-002 · ORM olarak Drizzle (Prisma değil)

- **Bağlam:** Prisma derleme ve migration için dışarıdan motor dosyaları indirir; geliştirme ortamlarından biri bu indirmeye izin vermiyor. Ayrıca migration'ların düz SQL olarak review edilebilmesi isteniyor.
- **Karar:** Drizzle ORM + drizzle-kit. Şema TypeScript'te, migration'lar düz SQL.
- **Sonuç:** Ek binary yok, üretilen SQL görünür. Karmaşık sorgular SQL'e yakın yazılır.

## K-003 · Kararlı ana sürümlere sabitleme

- **Bağlam:** Eylül 2026 itibarıyla TypeScript 7, NestJS 12, Prisma 8 gibi yeni ana sürümler çıktı ya da çıkmak üzere.
- **Karar:** Node.js 24 LTS, TypeScript 5.9, NestJS 11, Next.js 16, Vitest 3, ESLint 9. Bütün sürümler tam sabit (`^` yok). Faz 2'de Vitest 4.1 ve ESLint 10'a geçildi (K-012).
- **Sonuç:** Öngörülebilir kurulum. Güncellemeler Dependabot PR'larıyla, testler geçtikten sonra alınır. Ana sürüm yükseltmeleri ayrı iş olarak planlanır.

## K-004 · API sunucusu Fastify

- **Karar:** NestJS, Express yerine Fastify adaptörüyle çalışır. Güvenlik başlıkları `@fastify/helmet`, istek gövdesi 64 KB ile sınırlı.
- **Sonuç:** Daha yüksek istek kapasitesi (NFR-01). Fastify sürümü NestJS'in beklediği sürüme sabitlenir; iki farklı Fastify kopyası tip hatası verir.

## K-005 · Oturum: sunucu tarafında, JWT değil

- **Bağlam:** Platformun token'ı doğrulandıktan sonra oyuncunun oturumu nasıl taşınacak? Seçenekler: kendi JWT'mizi üretip tarayıcıya vermek ya da sunucuda oturum tutup tarayıcıya rastgele bir anahtar vermek.
- **Karar:** Sunucu tarafı oturum. Tarayıcıya sadece rastgele 256 bit token, HttpOnly çerezde. Oturum verisi Redis'te, anahtar olarak token'ın SHA-256 özeti.
- **Sonuç:** Çıkış ve oturum iptali anında geçerli olur (JWT'de süre dolana kadar geçerli kalırdı). Token JavaScript'e hiç gelmez. Bedeli her istekte bir Redis okuması; bu ölçekte önemsiz.

## K-006 · JWT kütüphanesi: jose

- **Karar:** Token doğrulama ve imzalama için `jose`. Algoritma listesi her zaman açıkça `['RS256']` verilir.
- **Neden:** Bağımlılıksız, standartlara uyumlu, anahtar türü ile algoritma uyuşmazlığını kendisi de reddediyor. Kendi JWT doğrulamamızı yazmak hataya en açık yol olurdu.

## K-007 · Arka plan işleri API sürecinde, bayrakla

- **Bağlam:** Fiyat alıcı saniyede bir çalışmalı; ileride görev ve lig kapanışı işleri de gelecek. Ayrı bir worker uygulaması mı, API içinde mi?
- **Karar:** Aynı kod ve aynı paket; işler API sürecinin içinde, `WORKERS_ENABLED` ile açılıp kapanır. Yerelde açık. Üretimde API birden çok kopya çalışırken yalnızca bir kopyada (ya da ayrı bir "worker" kopyasında) açık olur.
- **Sonuç:** Tek süreç, basit geliştirme. İki kopyada yanlışlıkla açık kalsa bile fiyat yazımı "yalnızca daha yeniyse" kuralıyla güvenli; ama iş yükü iki katına çıkar. Yük arttığında ayrı giriş noktasına (`worker.ts`) taşınır.

## K-008 · Bellek içi sahteler ve gerçek veritabanı testleri birlikte

- **Bağlam:** Servis ve uç testleri hızlı olsun diye bellek içi sahtelerle çalışıyor. Ama sahte, SQL'deki bir hatayı göremez.
- **Karar:** Veritabanı ve Redis koduna ayrıca `*.int.test.ts` entegrasyon testleri yazılır (`npm run test:int`). CI'da gerçek PostgreSQL 17 ve Redis 7.4 ile çalışır. Tenant ayrımı, eşzamanlı istek ve kilit davranışı mutlaka burada sınanır.
- **Sonuç:** İlk entegrasyon testi, sahte testlerin geçtiği bir hatayı yakaladı: Drizzle ham SQL içindeki kolonu tablo adı olmadan yazıyordu ve "üye sayısı" her ligde 0 dönüyordu. Ham SQL'de tablo adları artık açıkça yazılır.

## K-009 · Para hesapları BigInt ile, veritabanında değil kodda

- **Bağlam:** Tutar (2 ondalık), miktar ve fiyat (10 ondalık) JavaScript `number` ile tam hesaplanamaz. Seçenekler: hesabı SQL'de `numeric` ile yapmak, bir ondalık kütüphanesi eklemek ya da BigInt.
- **Karar:** Değerler veritabanı ölçeğinde tam sayıya çevrilip BigInt ile hesaplanır (`orders/fixed-point.ts`, `orders/order-math.ts`). Her bölmede yuvarlama yönü açıkça seçilir ve her zaman kasanın lehinedir: alışta miktar aşağı, tutarla satışta verilen miktar yukarı, değerlemede tutar aşağı.
- **Sonuç:** Yeni bağımlılık yok. Kurallar SQL'e dağılmadan tek yerde ve bellek içi testlerle sınanıyor. Veritabanındaki CHECK kısıtları ikinci savunma hattı.

## K-010 · Emir işleme: kilit sırası ve idempotency

- **Karar:** Her emir tek transaction: lig `FOR SHARE`, üyelik `FOR UPDATE`, sonra idempotency kontrolü, kurallar ve yazma. İdempotency anahtarı üyelik başına tekildir; kayıtta isteğin SHA-256 özeti tutulur. Aynı anahtar aynı istekle gelirse önceki sonuç 200 ile döner, farklı istekle gelirse 409.
- **Neden:** İdempotency kontrolü kilitten sonra yapıldığı için aynı anahtarlı paralel istekler de tek emir üretir. Lig kilidi, ileride lig kapanışının (FR-32) işlem sürerken sıralamayı dondurabilmesini sağlar. Reddedilen emir (ör. yetersiz bakiye) anahtarı harcamaz.
- **Sonuç:** Aynı oyuncunun aynı ligdeki emirleri sıraya girer (bir oyuncu için saniyede birkaç emir, sorun değil); farklı oyuncular birbirini beklemez.

## K-011 · Sıralama ve lig sonu ödülleri

- **Sıralama:** Toplam değer (nakit + pozisyonların son fiyatla değeri) büyükten küçüğe. Eşit değerde sıra paylaşılır (1, 2, 2, 4). Portföy ekranı, sıralama ve kapanış aynı değerleme fonksiyonunu kullanır (`orders/valuation.ts`).
- **Hesaplama:** Süren ligler 2 sn'de bir yeniden hesaplanır ve Redis sorted set'e yazılır (skor = kuruş). Yeni liste geçici anahtara yazılıp tek adımda yerine konur. Biten ligin sıralaması artık hesaplanmaz.
- **Kapanış:** Lig özel kilitliyken final sıra, final değer ve kapanış fiyatları PostgreSQL'e yazılır, XP dağıtılır, lig `finished` olur. Kapanmış ligin sıralaması ve portföy ekranı bu kayıttan okunur ve bir daha değişmez.
- **Ödüller (yalnızca XP, NFR-06):** 1. sıra 1000, 2. sıra 600, 3. sıra 400, ilk %10 150, diğer katılımcılar 50. Ödül için ligde en az bir emir vermiş olmak gerekir; hiç işlem yapmadan, düşen piyasada başlangıç bakiyesiyle birinci olup ödül alınamaz.
- **Tekrar güvenliği:** Her XP `xp_ledger` tablosuna (oyuncu, sebep, kaynak) tekilliğiyle yazılır; kapanış iki kez çalışsa bile ödül bir kez verilir.

## K-012 · Bağımlılık güvenlik uyarıları

- **fastify:** NestJS 11 fastify'ı 5.11.3'e sabitliyor; bu sürümde iki orta seviye açık var (GHSA-w2qp-rph6-63g4, GHSA-3m5p-2c4r-xxw2). İkisi de bizim kullanım şeklimizde tetiklenmiyor (doğrulama zod ile, `trustProxy` kapalı), yine de npm `overrides` ile 5.12.5'e çıkarıldı. `npm audit --omit=dev` temiz.
- **Kalan 6 uyarı yalnızca geliştirme araçlarındaydı** (vitest ve drizzle-kit içindeki eski esbuild). Faz 2, 2. adımda kapatıldı:
  - **Vitest 3.2 → 4.1.11.** 5.0 o sırada iki haftalıktı; K-003 gereği olgun seriye geçildi. Test yazımında değişiklik gerekmedi.
  - **ESLint 9 → 10.10, @eslint/js 10.** Yapılandırma `eslint/config` içindeki `defineConfig` ile yazıldı (`tseslint.config` eskidi). Kurallar aynı.
  - **drizzle-kit 0.31.10'da kaldı:** yeni seri (1.0) hâlâ beta. İçindeki `@esbuild-kit/core-utils` paketinin eski esbuild'i npm `overrides` ile drizzle-kit'in kendi kullandığı 0.25.12'ye sabitlendi; `generate`, `check` ve `migrate` boş ve dolu veritabanında denendi. drizzle-kit 1.0 kararlı çıkınca override kaldırılır.
  - Sonuç: `npm audit` (geliştirme paketleri dahil) 0 uyarı.
- **next 16.3.5 → 16.3.8 (Faz 3, adım 5 sonrası):** `next/og` içinde kritik RCE uyarısı (GHSA-vcvr-r3jv-pc5j) yayımlandı, CI'daki `npm audit --omit=dev` kırmızıya döndü. Yama sürümüne çıkıldı, `npm run check` yeşil, `npm audit` temiz.

## K-013 · Görevler için PostgreSQL outbox, BullMQ değil

- **Bağlam:** Görev ilerlemesi (FR-07) oyuncuyu bekletmeden arka planda hesaplanmalı. Planda BullMQ (Redis kuyruğu) vardı.
- **Sorun:** Emir PostgreSQL'e yazıldıktan sonra kuyruğa ayrı bir adımla iş eklenir. Arada uygulama çökerse ya da Redis erişilemezse olay kaybolur; görev ilerlemez.
- **Karar:** Transactional outbox. Emir, lige katılma ve platform olayı kaydedilirken aynı transaction'da `outbox_events` tablosuna bir satır yazılır. Worker satırları `FOR UPDATE SKIP LOCKED` ile alır, oyuncunun görevlerini değerlendirir, satırı işlendi olarak işaretler. Hata olursa yalnızca o oyuncunun olayları artan bekleme süresiyle tekrar denenir.
- **İlerleme sayılır, biriktirilmez:** Olay yalnızca "bu oyuncunun görevlerine bak" sinyalidir. İlerleme her seferinde kaynak veriden (emirler, üyelikler, platform olayları) sayılır; aynı olay iki kez işlense de sonuç değişmez. XP defteri (K-011) görev + dönem başına tek ödül garantiler.
- **Sonuç:** Yeni bağımlılık yok, olay kaybı yok, birden çok worker güvenle çalışır. Bedeli: saniyede bir küçük sorgu. Olay hacmi çok büyürse (on binlerce/sn) Kafka ya da SQS gibi bir kuyruğa taşınır; outbox deseni o durumda da kalır.

## K-014 · Webhook doğrulaması: HMAC-SHA256

- **Karar:** Platform her isteği `HMAC-SHA256(anahtar, "<unix saniye>.<ham gövde>")` ile imzalar; `x-lig-issuer`, `x-lig-timestamp`, `x-lig-signature: v1=<hex>` başlıklarıyla gönderir. Zaman damgası ±5 dk, olay kimliği platform başına tekil, karşılaştırma sabit sürede. Her ret aynı genel 401'i alır; sebep yalnızca logda.
- **Neden SSO anahtarı değil:** Platformun giriş token'larını imzaladığı RSA anahtarı webhook için de kullanılabilirdi, ama anahtar ayrımı ilkesi gereği farklı amaçlar farklı anahtar kullanır; biri sızarsa diğeri etkilenmez. HMAC, webhook için sektör standardı (Stripe, GitHub) ve platformların uygulaması kolay.
- **Bedeli:** Doğrulama için anahtarın okunabilir saklanması gerekiyor (özet tutulamaz). Faz 2'den itibaren şifreli saklanıyor (K-015).

## K-015 · Gizli değerlerin şifrelenmesi: arayüz bugün, anahtar servisi pilotta

- **Bağlam:** Webhook anahtarı (K-014) ve yöneticilerin MFA secret'ı doğrulama için okunabilir olmak zorunda, parola gibi özet olarak tutulamaz. Veritabanı ya da yedeği sızarsa saldırgan sahte webhook imzalar ya da MFA kodu üretir.
- **Karar:** `SecretCipher` arayüzü (`apps/api/src/secrets/`). Bugünkü uygulama AES-256-GCM. Ana anahtar `SECRET_KEYS` ortam değişkeninden gelir, üretimde zorunludur. Şifreli metin anahtar kimliğini taşır (`lig1.k1....`). Anahtar değişiminde yeni anahtar başa eklenir ve `npm run secrets:rotate` eski kayıtları yeniden şifreler. Bir anahtar kimliği yalnızca bir kez kullanılır (k1, k2, k3...): kayıt hangi anahtarla yazıldığını bu kimlikten bilir. `secrets:rotate` çözemediği kayıtları durmadan raporlar ve hata koduyla biter; bu uyarı varken eski anahtar silinmez.
- **Bağlam bağlama:** Her şifreli değer kendi satırına ve kolonuna bağlıdır (GCM ek doğrulama verisi, ör. `tenants.webhook_secret:<id>`). Veritabanına yazabilen biri A platformunun şifreli anahtarını B'nin satırına kopyalarsa çözme başarısız olur.
- **Neden varsayılan AWS KMS değil:** Müşterilerimiz SPK'ya tabi. Kripto varlık hizmet sağlayıcılarının birincil ve ikincil sistemleri yurt içinde olmak zorunda, TÜBİTAK kriterleri de (cüzdan anahtarları için) anahtarların Türkiye'de üretilip yedeklenmesini istiyor; uyum ekiplerinin bakışı buna yakın olur. AWS'nin İstanbul Local Zone'u (Mayıs 2026) tam bölge değil, Frankfurt'a bağlı ve KMS sunmuyor; anahtar Frankfurt'ta kalırdı. Ayrıca tek buluta bağlanmak, müşterinin kendi veri merkezinde çalıştırma seçeneğini kapatırdı.
- **Plan:** Faz 3.5'te OpenBao Transit adaptörü eklenir. OpenBao, Vault'un açık kaynak koludur ve Türkiye'deki bir veri merkezinde ya da müşterinin sunucusunda çalışır. Ana anahtar böylece uygulama ortamından çıkar. AWS KMS adaptörü yalnızca AWS'de barınan ve buna izin veren bir müşteri isterse yazılır.
- **Bedeli:** Pilot öncesinde ana anahtar uygulama ortam değişkeninde duruyor; sunucuyu ele geçiren anahtara da ulaşır. Veritabanı ya da yedek sızıntısına karşı koruma bugünden var.

## K-016 · Yönetici girişi

- **Parola:** argon2id, OWASP asgari değerleri (19 MiB, 2 tur, 1 iş parçacığı), PHC biçimi. Node 24.7+ içindeki `crypto.argon2` kullanılır: Windows'ta derleme gerektiren bir paket yok. Libargon2 referans vektörüyle sınanır. Unicode NFKC ile normalleştirilir. Kural yalnızca uzunluk: 12–128 karakter (NIST 800-63B). Hesap yoksa da boşa bir doğrulama yapılır, yanıt süresinden kayıtlı e-posta anlaşılmaz.
- **MFA:** TOTP (RFC 6238, SHA-1, 6 hane, 30 sn), herkes için zorunlu. Kod ±1 adım kabul edilir. Kullanılan adım veritabanına tek koşullu UPDATE ile yazılır: aynı kod ikinci kez, paralel isteklerle bile, kullanılamaz. Kurulumda secret önce giriş adımına (Redis, şifreli) yazılır, doğru kod girilince veritabanına geçer. Bağımlılık eklenmedi; RFC test vektörleriyle sınanır.
- **Akış:** Parola doğruysa 10 dk'lık giriş adımı çerezi (`/admin/auth` yolu). Doğru koddan sonra bu adım silinir ve yeni bir oturum token'ı üretilir (oturum sabitleme olmaz). Oturum çerezi `/admin` yoluna gider, süresizdir (tarayıcı kapanınca silinir). Sunucuda 30 dk hareketsizlik ve 8 saat mutlak süre uygulanır.
- **Rol ve hesap durumu her istekte veritabanından okunur.** Rolü düşürülen, silinen ya da MFA'sı sıfırlanan yöneticinin açık oturumu bir sonraki istekte geçersiz olur.
- **E-posta bütün sistemde tekil.** Girişte platform seçtirmeden hangi tenant'a ait olduğu bulunur. Aynı kişi iki platformu yönetecekse iki ayrı e-posta kullanır. İleride gerekirse yönetici-tenant ilişki tablosuna geçilir.
- **Deneme sınırları:** IP başına 15 dk'da 20 giriş, hesap başına 15 dk'da 10 giriş, yönetici başına 15 dk'da 5 kod, giriş adımı başına 3 kod. Parolayı bilen biri için MFA tahmin şansı günde yaklaşık %0,14. Bedeli: saldırgan bir yöneticiyi 15 dk girişten alıkoyabilir; hesap kalıcı kilitlenmez.
- **Gövdeli her istek JSON olmalı** (415). NestJS'in Fastify adaptörü form gövdesini varsayılan olarak kabul ediyordu; başka bir sitedeki HTML formu CORS'a takılmadan giriş ucuna istek atabilirdi (login CSRF). Bu kontrol oyuncu ve webhook uçları için de geçerli.
- **Henüz yok:** kurtarma kodları (MFA sıfırlama şimdilik `npm run admin:reset-mfa`, panelden 3. adımda), parola değiştirme, bir yöneticinin bütün oturumlarını kapatma, giriş olaylarının denetim kaydı.

## K-017 · Oyunlaştırma kapsamı

- **İlke:** Oyunlaştırma portföy değerini ve sıralamayı değiştirmez. Ödül yalnızca XP ve görünüm. Oyuncu hiçbir şeyi riske atarak ödül kazanmaz.
- **Alınanlar (Faz 3):** kademe ligleri (yükselme/düşme), günlük seri (1 gün kaçırma hakkıyla), XP jokeri, çeşitlendirme görevleri, karşılıksız günlük tahmin, rozet ve unvanlar, arkadaş ligi.
- **Alınmayanlar:**
  - **Portföyü etkileyen jokerler** (2 kat getiri, kaybı %3'te durduran kalkan, sektör jokeri): kaybı sınırlanan oyuncu için en iyi strateji en oynak varlığa hepsini basmak olur. Sıralama beceriden şansa kayar, "gerçekçi pratik" vaadiyle çelişir. Kalkanın gerçekçi hali stop-loss emir türüdür (Faz 4).
  - **XP çalan düello:** arkadaş ya da ikinci hesapla bilerek kaybedip XP taşımak mümkün. Arkadaş ligi aynı ihtiyacı karşılar.
  - **XP koyarak tahmin:** XP bugün paraya çevrilemez, ama bunu platform belirler; XP hediyeye bağlanırsa bahise yaklaşır. Fiyat yönüne puan koymak ikili opsiyona benzer (AB'de bireysel yatırımcıya yasak). Havuzlu sistemde ikinci hesapla XP taşınabilir.
  - **"BIST 30 dışından hisse ekle" görevi:** oyuncuyu belirli hisselere yönlendirir (NFR-06).
- **Hukuk sorusu (pilot öncesi):** karşılıksız tahmin görevi, `real_trade` görevi ve platformun XP'yi hediyeye bağlaması durumu.

## K-018 · Sıralama hileleri: kabul edilen riskler

- **Çoklu hesap:** Şimdilik kabul. Ödül yalnızca XP olduğu için kazanç düşük. Kimlik platformda; pilotta platformdan "kimliği doğrulanmış hesap" bilgisi istenir ve ödül buna bağlanabilir (Faz 3.5).
- **Son dakikada her şeyi tek varlığa basma:** Kabul, ek kural yok. Gerçek piyasadaki riskin aynısı, eğitsel açıdan sorun değil. Platform isterse ileride lig ayarı olarak varlık başına üst sınır eklenebilir (FR-20).

## K-019 · Denetim kaydı: yalnızca eklenebilir tablo ve özet zinciri

- **Bağlam:** NFR-07 değiştirilemez denetim kaydı istiyor. Lig ayarlarını, ekip değişikliklerini ve girişleri kimin yaptığı inkâr edilememeli (T7).
- **Karar:** PostgreSQL'de `audit_events` tablosu, iki koruma katmanıyla:
  1. **Tetikleyici:** `UPDATE`, `DELETE` ve `TRUNCATE` veritabanı seviyesinde reddedilir. Uygulamada bir hata olsa bile kayıt değişmez.
  2. **Özet zinciri:** Her kayıt, kendi zincirindeki (platform başına bir zincir, platforma bağlı olmayan olaylar için `system`) bir önceki kaydın SHA-256 özetini taşır. Tetikleyiciyi kapatabilen biri (veritabanı sahibi) bir kaydı değiştirir, siler ya da araya kayıt eklerse `npm run audit:verify` ve paneldeki "Zinciri doğrula" ilk bozuk kaydı gösterir.
- **Aynı transaction:** Ekip değişikliği ile kaydı aynı transaction'da yazılır; biri olmadan diğeri olmaz. Zincir başına danışma kilidi (`pg_advisory_xact_lock`) aynı anda yazılan iki kaydın aynı "önceki özet"i almasını engeller.
- **Yabancı anahtar yok:** Yönetici ya da platform silinse de kayıt kalır. İşlemi yapanın e-postası kayıt anındaki haliyle saklanır.
- **Kayda girmeyenler:** parola, token, TOTP kodu ve secret. Bilinmeyen e-postayla giriş denemeleri (hangi platformun zincirine yazılacağı belli değil; deneme sınırıyla ve uygulama loguyla izleniyor).
- **Bilinen sınır:** Zincirin **sonundan** silinen kayıtlar zincirden anlaşılamaz. Doğrulama son özeti gösterir; bu değer dışarıda saklanıp sonra karşılaştırılırsa anlaşılır. Faz 4: son özetin düzenli olarak dış bir yere yazılması ve uygulamanın tablonun sahibi olmayan, yalnızca `INSERT`/`SELECT` yetkili bir veritabanı rolüyle çalışması.

## K-020 · Ekip yönetimi

- **Roller:** Sahip (ekip, denetim kaydı ve her şey), düzenleyici (lig, görev ve marka ayarları; sonraki adımlarda), izleyici (yalnızca görüntüleme). Ekip ve denetim kaydı uçları yalnızca sahibe açık.
- **Davet:** E-posta altyapısı olmadığı için sahip davet linkini ekranda bir kez görür ve kendisi iletir. Link tek kullanımlık ve 72 saat geçerli; token veritabanında SHA-256 özetiyle saklanır ve adresin `#` sonrasında durur (sunucuya ve loglara gitmez). Aynı e-postaya yeni davet eskisini geçersiz kılar. Kabul sırasında davet satırı kilitlenir: aynı link aynı anda iki kez kullanılamaz. E-posta başka platformda yöneticiyse kabul reddedilir, davet geçerli kalır. E-postayla gönderim pilotta eklenir.
- **Sahip her zaman kalır:** Rol değiştirme, kaldırma ve MFA sıfırlama tenant satırını kilitler ve işlemi yapanın hâlâ sahip olduğunu kilitten sonra tekrar okur. İki sahip aynı anda birbirini düşürmeye çalışırsa yalnızca biri başarılı olur.
- **Kendi hesabında yapılamayanlar:** rol değiştirme, kaldırma, MFA sıfırlama. Oturumu ele geçirilmiş bir sahip MFA'yı kendi telefonuna taşıyamaz, platformu sahipsiz bırakamaz.
- **Oturum sürümü:** `admin_users.session_version` her oturumda saklanır ve her istekte karşılaştırılır. Parola değişimi, "diğer oturumları kapat" ve MFA sıfırlama sürümü artırır; o yöneticinin bütün açık oturumları bir sonraki istekte düşer. İşlemi yapan tarayıcıya yeni sürümle yeni oturum verilir.
- **CORS:** Panel `PATCH` ve `DELETE` kullandığı için bu yöntemler yalnızca web adresine açıldı.

## K-021 · Lig yönetimi: evreye göre düzenleme, katılım koşulu

- **Kaynak:** Tasarım dosyasındaki FR-20 kabul kriterleri: başlangıç bitişten önce, varlıklar yalnızca platformun kendi varlıkları, başlamış ligin başlangıç bakiyesi değişmez.
- **Evreye göre kural** (`leagueEditability`, `@lig/shared`; API karar verir, panel alanları buna göre kapatır):
  - **Taslak:** her şey değişir, silinebilir.
  - **Başlamamış:** her şey değişir. Başlangıç bakiyesi, taslağa geri alma ve silme yalnızca henüz kimse katılmadıysa. Aksi halde farklı bakiyeyle başlamış oyuncular olurdu.
  - **Süren:** ad, bitiş, varlık ekleme, kontenjan ve geç katılım. Başlangıç, bakiye, tip ve varlık çıkarma kilitli. Çıkarılan varlığı elinde tutan oyuncunun değerlemesi bozulurdu.
  - **Biten ya da kapanmış:** hiçbir şey değişmez.
- **Tarih sınırları:** Lig 1 saat ile 400 gün arası sürer. Başlangıç geçmişe çekilemez (5 dk saat farkı toleransı). Bitiş en az 5 dk sonrası olmalı; yönetici bitişi geçmişe çekip süren ligi anında kapatamaz.
- **Katılım koşulu:** Tasarım dosyası tanımlamıyordu. İki koşul uygulandı: **kontenjan** (en fazla N oyuncu) ve **geç katılım** (lig başladıktan sonra katılım açık ya da kapalı). "Yalnızca kimliği doğrulanmış hesaplar" koşulu platform token'ında bu bilgiyi gerektirdiği için pilota bırakıldı (K-018).
- **Yarışlar:**
  - **Kontenjan:** Katılım lig başına danışma kilidiyle sıraya girer. Kilit olmadan 30 eşzamanlı katılımda 10 kişilik kontenjan 20-22'ye çıkıyordu; test bunu yakalıyor.
  - **Düzenleme ve katılım:** Düzenleme ligi `FOR UPDATE` ile kilitler ve üye sayısını kilitten sonra ayrı sorguyla sayar. Katılım lig satırını `FOR SHARE` ile okur. Bu olmadan, bakiye değişirken katılan oyuncu eski bakiyeyi alabiliyordu; test bunu da yakalıyor. Emirler (`FOR SHARE`) ve lig kapanışı (`FOR UPDATE`) aynı kilit sırasını kullandığı için kilitlenme olmaz.
- **Denetim:** Oluşturma, düzenleme (her alan için eski ve yeni değer) ve silme, değişiklikle aynı transaction'da kayda girer (NFR-07).
- **Ödül alanı yok:** Lig formunda ve API'de ödül alanı bulunmaz; fazladan alan 400 ile reddedilir (FR-24).

## K-022 · Uyum ayarları: kilitli olanlar kodda, ayarlanabilir olanlar tenant'ta

- **Kilitli (kodda sabit, yazma ucu yok):** kişiye özel al/sat önerisi kapalı, nakit ya da nakde çevrilebilir ödül kapalı, portföyü etkileyen joker ve XP ile tahmin kapalı, oyuncu ekranında "sanal para, yatırım tavsiyesi değildir" uyarısı açık. Panel bunları gösterir; API'de değiştirecek bir alan yoktur (`complianceUpdateRequest` katı şema).
- **Neden veritabanında "kilitli" bayrağı değil:** Veritabanına yazabilen biri bayrağı çevirebilirdi. Kural kodda olunca değiştirmek kod incelemesinden ve CI'dan geçmeyi gerektirir.
- **Platform sahibinin seçimi (denetim kaydına girer):**
  - "Gerçek hesabıma geç" butonu: kapalıyken oyuncuya platform adresi hiç gönderilmez.
  - "Gerçek işlem yap" görevi: kapalıyken görev listelenmez, ilerlemez, XP vermez. Hukuki değerlendirme gelene kadar platform kapatabilsin diye.
- **Uygulama:** Ayarlar sunucuda uygulanır (`findPublicInfo`, `questStore.listActive`); arayüzde gizlemek yeterli sayılmaz.

## K-023 · Görev şablonları: sabit şablon, platform başına tek görev

- **Bağlam:** FR-21 yöneticinin görev tanımlamasını istiyor. Serbest metinli görev, ilerlemenin nasıl sayılacağı belirsiz olduğu için mümkün değil: ilerleme her zaman kaynak veriden sayılıyor (emirler, üyelikler, platform olayları).
- **Karar:** Yönetici yalnızca hazır şablonlardan seçer (`join_league`, `place_orders`, `trade_distinct_assets`, `real_trade`), dönemi (tek seferlik / haftalık), hedefi ve XP ödülünü belirler. Görev başlığı şablondan ve hedeften üretilir; yönetici metin yazmaz. Böylece oyuncu ekranındaki metin her platformda tutarlı ve XSS yüzeyi yok.
- **Şablon ve dönem sonradan değişmez:** Yalnızca hedef, XP ve aktiflik değişir. Şablonu değişen görev, oyuncuların birikmiş ilerlemesini anlamsız hale getirirdi.
- **Aynı şablon + dönemden tek görev:** `quests` tablosunda `(tenant_id, template, period)` tekil indeksi (`0009_quest_unique.sql`). İki "bu hafta 5 emir ver" görevi aynı olaydan iki kez XP verirdi. Sınır veritabanında: iki eşzamanlı istek de aynı görevi açamaz.
- **Ayrı sayı sınırı yok:** Görev sayısı şablon ve dönem kombinasyonu kadar olabilir (bugün 4 şablon × 2 dönem = 8). Önce "en fazla 20 görev" kontrolü yazılmıştı; tekil indeks zaten 8'i geçirmediği için ölü koddu ve kaldırıldı. Şablon listesi büyürse oyuncu ekranındaki görev sayısı için ayrı bir sınır gerekir.
- **Silme yerine pasife alma:** XP dağıtmış görev silinemez (`completions > 0`), yalnızca pasife alınır. Silinse `xp_ledger` kayıtları kaynaksız kalır ve XP'nin nereden geldiği denetlenemez. Hiç XP dağıtmamış görev silinebilir.
- **Ödül yalnızca XP:** Şemada para alanı yok; fazladan alan 400 ile reddedilir (FR-24, NFR-06).

## K-024 · Marka ayarları: renkten hesaplanan iki yazı rengi

- **Kapsam (FR-22):** Platform adı, ana renk ve logo adresi. Renk `tenants.theme` jsonb alanında saklanır.
- **Yazı rengi ayarlanmaz, hesaplanır.** Yönetici okunmaz bir kombinasyon seçemesin diye iki değer renkten üretilir (`@lig/shared`, saf fonksiyon, testli):
  - `--accent-text`: ana rengin **üstündeki** yazı (butonlar). WCAG göreli parlaklığa göre beyaz ya da koyu.
  - `--accent-readable`: koyu zeminde **ana renkle yazılan** yazı (link, XP, rozet, "gerçek hesabıma geç"). Renk, sayfa zemini (`#0d0f14`) ile kontrast 4.5:1 olana kadar beyaza doğru açılır. Lacivert (`#1d3f8f`) seçildiğinde yazılar zeminle karışıyordu; tarayıcı testi bunu yakaladı.
  - Zaten yeterli kontrasta sahip renk (varsayılan `#c6f24e`) olduğu gibi kalır.
- **Logo yalnızca https:** Adres sunucuda doğrulanır; kayıt elle bozulsa bile oyuncuya yalnızca `https://` adresi gider. `javascript:` ya da `data:` adresi oyuncunun oturumunda kod çalıştırma riski taşır.
- **Platform adı:** HTML ve kontrol karakteri kabul edilmez, 2-40 karakter. Ad denetim kaydına eski ve yeni değeriyle girer.
- **Yükleme yok:** Logo dosyası sunucuya yüklenmez, platform kendi adresini verir. Dosya yükleme depolama, boyut ve içerik denetimi gerektirir; pilotta değerlendirilir.

## K-025 · Metrikler: canlı sorgu, tıklama kaydı, karşılaştırma

- **Soru:** FR-23'ün cevaplaması gereken tek şey var: lig modülü platformda gerçek işlemi artırıyor mu?
- **Huni:** lige katılma → emir → "Gerçek hesabıma geç" dokunuşu → platformun webhook ile bildirdiği gerçek işlem (FR-31). Ortadaki adım ölçülmeden dönüşüm hesaplanamadığı için dokunuş `real_trade_clicks` tablosuna yazılır.
- **Tıklamada ne saklanır:** platform, bizdeki oyuncu satırı, varsa lig ve zaman. IP, tarayıcı bilgisi ve platformdaki kimlik yok (NFR-04). Lig kimliği istemciden geldiği için üyelik sunucuda doğrulanır; üye olmayan oyuncunun tıklaması ligsiz kaydedilir, başka bir ligin sayısını şişiremez.
- **Ölçüm oyuncunun yolunu kesmez:** istek `keepalive` ile gönderilir ve sonucu beklenmez; sayım başarısız olsa da bağlantı açılır.
- **Canlı sorgu, özet tablosu değil:** Pano açıldığında sayılar doğrudan tablolardan hesaplanır. Yeni worker, yeni migrasyon ve "dün gece hesaplandı" gecikmesi yok; pilot ölçeğinde (binlerce satır) yeterince hızlı. Yüz binlerce oyuncuda ölçüm yavaşlarsa günlük özet tablosuna geçilir; arayüz değişmez çünkü hesaplama `MetricsRepository` portunun arkasında.
- **Karşılaştırma:** Gerçek işlem yapan kullanıcılar üçe ayrılır: bir lige katılmış oyuncular, modülü açmış ama katılmamış oyuncular, modülü hiç açmamış platform kullanıcıları. Üçüncüsü `platform_events.player_id` boş olan kayıtlardan gelir; webhook ligi açmamış kullanıcıların olayını da taşıdığı için (ARCHITECTURE, webhook) karşılaştırma mümkün.
- **Sayım birimi:** Kullanıcı sayısı ile olay sayısı ayrı gösterilir. Aynı kullanıcının on işlemi "on kişi" gibi okunursa pilot görüşmesinde yanlış rakam konuşulur.
- **Dönem:** 7, 30 ya da 90 gün. Başka değer 400. Toplam oyuncu sayısı dönemden bağımsızdır, platformun bugünkü büyüklüğünü gösterir.
- **Rol:** Her rol görebilir, izleyici dahil. Metrik okumak bir değişiklik değil; denetim kaydına da girmez.

## K-026 · `check` ve `dev` shared paketini önce derler

- **Sorun:** `packages/shared` derlenmiş `dist` klasöründen tüketiliyor. Yeni bir dosya eklendiğinde (ör. `metrics.ts`) `dist` eski kaldığı için `npm run typecheck` "böyle bir export yok" diyordu, `npm run dev` ise tarayıcıda "undefined is not a function". `check` shared'ı zaten derliyordu ama en sonda, `build` adımında: typecheck ondan önce patladığı için derleme hiç sıraya gelmiyordu. CI'da görünmüyordu, çünkü `npm ci` postinstall ile shared'ı derliyor.
- **Karar:** `check`, `dev` ve `test:int` komutları `npm run shared:build` ile başlar. Ek maliyet bir saniyenin altında, karşılığında "benim makinemde çalışıyordu" sınıfı bir hata tamamen kalkıyor.
- **Neden kaynaktan tüketmiyoruz:** Paket `dist` yayımlıyor; kaynağa (TypeScript project references ya da `exports` ile `src`) geçmek API, web ve mock-platform'un derleme kurulumunu değiştirir. Bugünkü sorunu üç satırlık betik değişikliği çözüyor, bu iş Faz 4'e kalabilir.

## K-027 · Pay piyasası: seans saati, tavan/taban, ikinci sahte müşteri

- **İkinci sahte müşteri aynı uygulamada:** `apps/mock-platform` iki müşteriyi taklit eder: "Sahte Platform" (kripto, 4100, koyu tema) ve "Sahte Aracı Kurum" (BIST, 4200, açık tema). Ayrı issuer, ayrı anahtar çifti, ayrı webhook anahtarı, ayrı tenant. Ayrı bir uygulama açmak yeni bir şey kanıtlamazdı: izolasyon zaten lig API'sinde ve her sorgu tenant'a bağlı (NFR-03).
- **Seans saatleri:** Hafta içi 10:00-13:00 ve 14:00-18:00 (Türkiye saati, sabit UTC+3). Öğle arası kapalı sayılır: gerçekte o saatte tek fiyat seansı vardır, biz sürekli işlemi modelliyoruz. Bayram arifelerinde yarım gün (yalnızca sabah seansı). Kaynak: Borsa İstanbul pay piyasası işlem saatleri ve 2026 tatil tablosu.
- **Tatil takvimi kodda, elle güncellenir:** Dini bayramlar her yıl kaydığı için liste `MARKET_HOLIDAYS` sabitindedir ve her yıl Borsa İstanbul'un yayımladığı tablodan güncellenir. Takvimin kapsamadığı bir yılda yalnızca hafta sonu kuralı uygulanır ve `calendarKnown: false` döner; sessizce yanlış sonuç vermek yerine durumu bildirir. Pilotta takvim veri sağlayıcısından gelecek.
- **Seans dışında emir yok:** Hisse varlığında emir 409 `MARKET_CLOSED` ile reddedilir, mesajda bir sonraki açılış yazar. Kripto varlıklar 7/24 açık; aynı ligde ikisi varsa yalnızca hisseler kapanır. Kural sunucuda: arayüzde paneli kilitlemek yeterli sayılmaz.
- **Seans dışında fiyat donar:** Platform akışı fiyat göndermeye devam etse de hisse fiyatı saklanmaz; ekranda son kapanış görünür ("son kapanış" etiketiyle, "güncel değil" değil).
- **Tavan/taban önceki kapanışa göre:** Gerçek kural budur. Kapanış fiyatı seans bittikten sonra `assets.reference_close` ve `reference_close_date` alanlarına yazılır; ertesi gün limit bunun ±%10'udur. Akıştan gelen fiyat aralığın dışındaysa sınıra çekilir, aralıktaysa string olarak aynen saklanır (hassasiyet kaybı olmaz).
- **Yanlış güne kapanış yazılmaz:** Kapanış yalnızca o günün kendi seansı bittikten sonra yazılır. Öğle arasında ve seans açılmadan önce de "kapalı" görünür; o anda yazılsaydı bugünün canlı fiyatı dünün kapanışı olurdu. API akşam kapalıysa o günün kapanışı boş kalır ve ertesi gün limit uygulanmaz: uydurma limit yerine limitsiz gün.
- **Referansı olmayan varlıkta limit yok:** Yeni eklenen hisse ilk kapanışa kadar limitsizdir. İlk günün açılış fiyatına göre limit koymak gerçek kuralla uyuşmazdı.
- **Tema modu marka ayarında:** `tenants.theme` jsonb alanına `themeMode` eklendi (yeni kolon gerekmedi). Oyuncu ekranı `data-theme` ile CSS token setini değiştirir; marka renginden hesaplanan okunur yazı rengi artık zemine göre hesaplanır (koyu zeminde beyaza, açık zeminde siyaha doğru).

## K-028 · Demo için gerçek kripto fiyatı

- **Sorun:** Demo görüşmesinde ekrandaki fiyatlar uydurma olunca ilk soru "bunlar gerçek mi" oluyor ve konu üründen çıkıyor.
- **Karar:** Gerçek fiyatı lig modülü değil, sahte platform çeker. Modülün fiyat sözleşmesi (FR-30) aynen kalır: platform kendi ucunda fiyat yayınlar, biz okuruz. Pilotta bu işi gerçek platform yapacağı için demo da gerçeğe uygun çalışır. Modüle borsa adaptörü koymak, tasarımdaki "fiyat platformdan gelir" kuralını bozardı.
- **Kaynak:** BtcTurk'ün halka açık ticker ucu (`/api/v2/ticker`). Anahtar istemez, TL pariteleri vardır (sanal bakiye TL olduğu için önemli) ve belgelenmiş limiti bizim kullanımımızın çok üstünde: tek istekte bütün pariteler, varsayılan 2 saniyede bir. Kaynak adresi ortam değişkeniyle değiştirilebilir.
- **Varsayılan kapalı:** `MOCK_PLATFORM_PRICE_MODE=real` demeden dışarı hiç istek gitmez. Geliştirme ve CI sahte fiyatla çalışır; testler ağa çıkmaz, kaynak enjekte edilir.
- **Zaman damgası bizim okuma anımızdır**, borsanın verdiği değil. Borsanın saati bizden ileriyse lig API'si fiyatı "gelecekten geldi" diye reddederdi.
- **Kaynak susarsa:** Son bilinen fiyat yayınlanmaya devam eder ama zaman damgası tazelenmez; 5 saniye sonra lig API'si fiyatı bayat sayar ve emir kabul etmez. Uydurma tazelik, yanlış fiyattan emir demek olurdu. Hiç fiyat alınamadıysa simülasyona düşülür: demo boş ekranla başlamaz.
- **Kaynak ekranda görünür:** Sahte platform sayfasında "gerçek borsa / simülasyon", son okuma zamanı ve varsa son hata yazar. Demo sırasında hangisinin açık olduğu tartışma konusu olmaz.
- **BIST tarafı sahte kalır:** Gerçek BIST verisi lisanslı. Aracı kurum müşterisi sahte fiyatla çalışmaya devam eder (Faz 3.5).
- **Açık konu:** Borsanın API kullanım şartları (ticari kullanım, atıf, izin) pilot öncesi teyit edilmeli. Belgelerde hız sınırları var; kullanım şartlarını buradan doğrulayamadım. Mod varsayılan kapalı olduğu için bugün risk yok, ama müşteriye açık bir demoda açılmadan önce bakılmalı.

## K-029 · Çeşitlendirme görevi: "N farklı sektörden varlık al"

- **Amaç:** Oyuncuyu tek varlığa yığılmaktan çıkarmak (K-017: çeşitlendirme). Ödül yalnızca XP, sıralamaya ve portföye etkisi yok.
- **Şablon:** `buy_distinct_sectors`, mevcut şablon mekanizmasıyla (K-023) eklendi. Ayrı tablo ya da sayaç yok: ilerleme `virtual_orders` ve `assets.sector`'dan sayılır, aynı olay iki kez gelse de sonuç değişmez. XP tekilliği `xp_ledger`'daki mevcut `(oyuncu, sebep, kaynak)` kısıtından gelir; yeni yarış yüzeyi doğmadı.
- **Yalnızca alış:** Satış sayılmaz. Görev adı "varlık al"; satışı saymak, alıp hemen satarak hedefi kolaylaştırırdı.
- **Sektörü olmayan varlık sayılmaz:** Kripto varlıkların sektörü yok. Kripto platformunda bu görev ilerlemez, bu yüzden seed yalnızca sektörlü varlığı olan platforma ekler. Yönetici paneli şablonu her platforma sunar; kripto platformu eklerse görev tamamlanamaz. Bunu panelde uyarı olarak göstermek küçük bir iş, ihtiyaç olursa eklenir.
- **Sektör serbest metin:** `assets.sector` seed ile girilir ("Bankacılık" ile "bankacılık" iki sektör olur). Pilotta varlık listesi platformdan geldiğinde sektör adları normalize edilmeli (Faz 3.5).
- **Kabul edilen risk (K-018):** Farklı sektörlerden üç küçük alış hedefi tamamlar. `trade_distinct_assets` ile aynı seviyede ve yalnızca 150 XP; çoklu hesap ya da son dakika riskini büyütmez.
- **Migration:** `0012_quest_sector_template.sql` yalnızca `quests_template_known` CHECK kısıtını genişletir. Varsayılan görev sayısı üst sınırı 5 şablon × 2 dönem = 10 oldu (K-023).

## K-030 · Rozet, unvan ve profil çerçevesi: katalog kodda, kazanım kaynak veriden

- **Amaç:** Oyuncuya kalıcı bir ilerleme hissi vermek (FR-10). Ödül yalnızca görünümdür: XP, bakiye ya da sıralama vermez (NFR-06, K-017). Sıralamada yalnızca unvan yazısı ve çerçeve görünür; sıra ve değer aynı kalır.
- **Katalog kodda sabit** (`packages/shared/src/gamification.ts`): rozetler, çerçeveler, unvanlar. Veritabanında katalog tablosu ve yönetici panelinden değiştirme yok; yönetici rozet ekleyemez ya da kolaylaştıramaz. Yeni rozet kod incelemesinden geçer. Veritabanı yalnızca kimlikleri CHECK kısıtıyla kataloğa bağlar.
- **İlk set:** İlk Emir, Çeşitli Portföy (aynı ligde 3 farklı varlıktan alış), Görev Avcısı (5 tamamlanmış görev), Lig Bitirici, Podyum (ilk 3), Tavan Avcısı (K-031). Temettü Emeklisi ve Açığa Satış Üstadı motor genişleyince Faz 4'te.
- **Çerçeve rozete bağlı:** Her rozetin bir çerçevesi var; çerçeve rozeti kazanana açılır. Ayrı bir kazanma yolu ve ayrı bir kötüye kullanım yüzeyi yok.
- **Unvan XP eşiğinden türetilir, saklanmaz** (Çaylak 0, Acemi 100, Deneyimli 500, Portföy Ustası 1.500, Piyasa Kurdu 4.000). XP hiç düşmediği için kazanılan unvan geri gitmez. Saklanan yalnızca oyuncunun seçimidir (`players.selected_title`); sıralamada gösterilirken eşik yeniden doğrulanır (`resolveTitle`), veritabanı elle bozulsa bile sahip olunmayan unvan görünmez.
- **Kazanım outbox worker'ında** (K-013). Her değerlendirmede görevlerden sonra tek `INSERT ... SELECT ... ON CONFLICT DO NOTHING` çalışır; koşullar kaynak veriden (emirler, üyelikler, görev ilerlemesi, `asset_limit_days`) sayılır, olay sayacı yok. Aynı sinyal iki kez ya da iki worker'da işlense de sonuç aynı. Tekillik `player_badges (player_id, badge_id)` birincil anahtarında. `ON CONFLICT` bilerek hedefsiz yazıldı: kısıt kalkarsa test çift kayıt görür.
- **Rozet geri alınmaz.** Kaynak emir silinse ya da XP değişse de kazanılan rozet kalır (`earned_at` değişmez).
- **Sinyaller:** Emir, katılma ve platform olayları zaten worker'ı uyandırıyor. İki yeni kaynak için `outbox_events`'e `badge_recheck` türü eklendi (migration 0013): lig kapanışı (ligin bütün üyeleri, kapanışla aynı transaction'da) ve tavan günü kaydı (o gün o hisseden alış yapanlar, K-031).
- **Seçim atomik ve sahiplik güncellemenin içinde.** `PUT /profile/appearance` tek `UPDATE` çalıştırır; koşullar `WHERE` içinde (oyuncu + tenant, unvan için `xp >= eşik`, çerçeve için `exists (player_badges)`). Okuyup sonra yazma yok, bu yüzden sahiplik kontrolüyle yazma arasında pencere kalmaz. Hem unvan hem çerçeve istenirse biri sahip olunmazsa hiçbiri yazılmaz. Oyuncu kimliği oturumdan gelir, gövdedeki fazladan alan 400.
- **Arkadaş ligi rozet saymaz.** `type = 'friends'` liglerde Lig Bitirici ve Podyum verilmez: iki kişilik bir ligde podyum garantidir. Adım 4'te arkadaş ligi eklendiğinde bu koşul zaten yerinde.
- **Denetim kaydı yok:** Bunlar yönetici eylemi değil, oyuncunun kendi görünüm seçimi; `AUDIT_ACTIONS`'a girdi eklenmedi.
- **Kabul edilen risk (K-018):** Çoklu hesapla her rozet ve çerçeve kolayca toplanır (tek emir İlk Emir'e yeter). Ödül yalnızca görünüm olduğu için kazanç yok; XP ya da sıralama vermediğinden büyütülmüş sayılmaz.
- **Açık konu:** Podyum için en az üye sayısı koşulu yok; tek kişilik bir platform ligiyle podyum alınabilir. Lig oluşturmayı yönetici yaptığı için risk düşük; istenirse "en az N emir vermiş üye" koşulu eklenir.
- **Migration:** `0013_badges_titles_frames.sql`: `player_badges`, `asset_limit_days`, `players.selected_title` ve `selected_frame`, `outbox_event_type` değeri.

## K-031 · "Tavan Avcısı": tavan günü kaydı ve tanım

- **Tanım (proje sahibi onayladı):** Oyuncu, bir hissenin o gün tavanda kapandığı seansta o hisseden alış yapmışsa kazanır. Satış, tabanda kapanan hisse ve başka günün alışı sayılmaz.
- **Kaynak veri:** `asset_limit_days (asset_id, session_date, kind)`. `MarketCloseService` seans kapanışını yazarken aynı transaction'da, önceki kapanışa göre tavanda (`limit_up`) ya da tabanda (`limit_down`) kapanmışsa buraya yazar. Karar `limitStateAtClose` (`@lig/shared`, saf fonksiyon, testli): akış sınırın ötesindeki fiyatı sınıra çektiği için tavanda kapanan hisse tam sınır fiyatıyla kapanır. Önceki kapanışı olmayan (yeni) hisse için limit olmadığından tavan da yok (K-027).
- **Neden emir zamanı değil seans günü:** Emrin verildiği gün Türkiye takvimiyle (UTC+3) kapanış günüyle eşleşir. Rozet sorgusu ve sinyal sorgusu aynı gün tanımını kullanır; gün sınırı (00:00 ve 23:59) testli.
- **Yarış:** Kapanış yazımı satırı `FOR UPDATE` ile kilitler ve önceki kapanışı kilitten sonra okur. Kilit olmadan 8 eşzamanlı yazımın hepsi "kapanışı ben yazdım" der: kapanış sayımı ve rozet sinyali çoklanır (tavan günü satırı `ON CONFLICT` ile zaten tek kalır); test bunu yakalıyor.
- **Bilinen sınır (geriye bakış):** Gün içi fiyat geçmişi tutmuyoruz. Hisse seans sırasında tavana çıktıktan sonra alış yapan da, sabah alan gibi kazanır. Gerçek piyasada tavan kilitliyken alış çoğu zaman gerçekleşmez; bizde emir tavan fiyatından dolar. Bu yüzden rozet "tavanı önceden görme" değil "tavan günü işlem yapma" ölçer. Sıkılaştırmak için gün içi fiyat serisi gerekir (emir, hissenin tavana ilk ulaştığı andan önce verilmiş olmalı); Faz 3.5'te gerçek veri gelince değerlendirilir. Karar proje sahibinin.
- **K-017 ile ilişki:** Rozet tavana çıkacak hisseyi önceden bilmeyi gerektirmez, alım anında hangi hissenin tavan olacağı bilinmez; yine de tavan hisselerini kovalamayı özendirebilir. Kişiye özel öneri yok, ödül yalnızca görünüm. Pilot öncesi hukuk sorularına (K-017'deki liste) eklenmeli: "Tavan Avcısı" adı bir getiri vaadi gibi okunabilir mi.
- **K-018:** "Son dakikada tek varlık" riskini biraz büyütür: seansın son dakikasında tavanda olan hisseyi alıp rozeti garantilemek mümkün. Etki yalnızca görünüm.

## K-032 · Günlük seri ve XP jokeri

- **Amaç:** Oyuncuyu her gün uygulamaya döndüren hafif bir alışkanlık döngüsü (K-017). Ödül yalnızca XP ve görünümdür; joker portföyü ya da sıralamayı değiştirmez (NFR-06).
- **Etkin gün:** O gün ekranı açmak (ziyaret) ya da emir vermek. Gün Türkiye takvimiyle (UTC+3). Ziyaret `player_activity_days (oyuncu, gün)` tablosuna yazılır, tekil; emir günleri mevcut emirlerden okunur, ayrı sayaç yok.
- **Seri hesaplanır, saklanmaz** (`computeStreak`, `@lig/shared`, saf fonksiyon, testli). Art arda iki etkin gün arasında en fazla bir boş gün olabilir: "1 gün kaçırma hakkı". Son etkin günden 3 ya da daha çok gün geçtiyse seri biter. Seri, etkin gün sayısıdır.
- **Ödül:** Her 7 etkin günde 25 XP ve bir XP jokeri. Kaynak kimliği `serininBaşlangıcıGünü:7|14|...`; XP defterinin `(oyuncu, sebep, kaynak)` tekilliği ve `xp_jokers (oyuncu, kaynak)` tekilliği aynı eşiğin ikinci kez ödüllenmesini engeller. Ödül hem ziyarette hem outbox worker'ında (emir günleri için) hesaplanır; ikisi aynı anda çalışsa da bir kez verilir. Seri kopup yeniden başlarsa yeni başlangıç günü yeni kaynak demektir, yeni seri yeniden ödül kazanır.
- **Joker:** Oyuncu etkinleştirir, etkinleştirdiği andan 7 gün sürer. Etkinken tamamlanan görevin XP'si bir kez daha verilir (`joker_bonus`, kaynak görev + dönem), yani 2 kat. Tamamlanma anı, olayın oluştuğu andır (worker gecikmesi oyuncuyu cezalandırmaz). Yalnızca az önce yeni verilen görev XP'si için bonus yazılır: tekrar değerlendirme, joker etkinleşmeden önce tamamlanmış görev ve süresi dolmuş joker bonus üretmez. Lig sıralaması XP'si, seri XP'si ve rozetler 2 katlanmaz.
- **Tek etkin joker:** Etkinleştirme oyuncu satırını `FOR UPDATE` ile kilitler; ikinci eşzamanlı istek birincinin etkin jokerini görür ve 409 alır. Kilit olmadan üst üste binen süreler ve ikiye katlanan etki mümkün olurdu; test bunu yakalıyor.
- **API:** `GET /streak`, `POST /streak/visit` (ekran açılışında web çağırır, günde tek satır), `POST /streak/joker/activate`. Oyuncu kimliği oturumdan; istekten gün ya da kimlik alınmaz, bu yüzden geçmiş güne ziyaret yazılamaz.
- **Kabul edilen risk (K-018):** Çoklu hesapla her hesapta seri ve joker toplanabilir; ödül yalnızca küçük XP ve görünüm olduğu için kazanç düşük. Seri çoklu hesap avantajını büyütmez ama 7 günde bir XP verdiği için hesap başına küçük bir getiri ekler. Pilotta "kimliği doğrulanmış hesap" bilgisi gelince ödül buna bağlanabilir.
- **Açık konu:** Ziyaret, sayfayı açmak kadar kolaydır (bot ya da tek istek). Emir günleri gerçek eylemdir. İstenirse ziyaret yerine "bir emir ya da bir görev ilerlemesi" şartı getirilir.
- **Migration:** `0014_daily_streak_xp_joker.sql`: `player_activity_days`, `xp_jokers`, `xp_reason` değerleri `streak` ve `joker_bonus`.

## K-033 · Arkadaş ligi ve davet kodu

- **Amaç:** Oyuncuların arkadaşlarıyla küçük, kapalı bir lig kurması (FR-09). Normal ligin kuralları aynen geçerli (emir motoru, sıralama, kapanış); fark yalnızca kimin gördüğü ve neyin ödüllendiği.
- **Kurallar kodda sabit** (`FRIENDS_LEAGUE`, `@lig/shared`): en fazla 10 üye, 100.000 TL başlangıç bakiyesi, süre 7, 14 ya da 30 gün, oyuncu başına aynı anda en fazla 3 etkin kendi ligi. İstemci yalnızca ad ve süre seçer; bakiye, kontenjan, varlık ve tür katı şemada yok (fazladan alan 400). Varlıklar oyuncunun platformunun varlıklarıdır (en fazla 50). Veritabanı da kuralı tutar: `leagues_friends_shape` (arkadaş ligi için kod ve 2-10 kontenjan zorunlu) ve `leagues_invite_only_friends` (kod yalnızca arkadaş liginde).
- **Davet kodu:** 10 karakter, 32 harflik alfabe (0, O, 1, I yok), yaklaşık 50 bit, `crypto.randomInt` ile üretilir, `leagues.invite_code` üzerinde tekil. Kod düz saklanır: üyeler kodu her zaman yeniden görebilmeli; tek kullanımlık davet linkinin (K-020) tersine bu paylaşılan bir koddur. Sızarsa etkisi yalnızca 10 kişilik kapalı bir lige girmektir. Girişte büyük harfe çevrilir, boşluk ve tire atılır.
- **Kod tahmini:** `POST /friends/join` oyuncu başına dakikada 10 deneme (T9). Kod yalnızca oyuncunun kendi platformunda aranır; yanlış kod, başka platformun kodu ve arkadaş ligi olmayan lig aynı 404'ü alır.
- **Görünürlük:** Arkadaş ligi yalnızca üyesine görünür (liste, detay, sıralama, portföy). Üye olmayan için "yok" ile aynı yanıt. Davet kodu yalnızca üyeye döner. Normal katılım ucu (`/leagues/:id/join`) arkadaş ligine kapalıdır, yalnızca kodla girilir. Yönetici panelinde lig salt okunur görünür, düzenlenemez.
- **XP ve rozet yok:** Arkadaş ligi kapanışında XP verilmez; Lig Bitirici ve Podyum saymaz (K-030); "Bir lige katıl" görevi arkadaş ligine katılmayı saymaz. Sebep: iki hesapla (ya da bir arkadaşla) kasten kaybedip XP taşımak ve kendi ligini kurup görev toplamak mümkün olurdu (K-017'deki "XP çalan düello" gerekçesi). Emirler emir görevlerine, seriye ve "İlk Emir" rozetine sayılır; bunlar zaten ligden bağımsız gerçek eylem.
- **Yarışlar:** Kurma, oyuncu başına danışma kilidiyle sıralanır ("en fazla 3" sayımı eşzamanlı isteklerle aşılamaz). Katılma, normal lig katılımıyla aynı lig başına danışma kilidini kullanır ve lig satırını paylaşımlı kilitler (kapanış özel kilit alır): 25 eşzamanlı katılımda üye sayısı 10'u aşmaz. Aynı oyuncunun eşzamanlı katılımı tek üyelik açar. Kod çakışması `ON CONFLICT DO NOTHING` ile yeniden denenir.
- **Kapanış:** Mevcut zamanlayıcı süresi dolan arkadaş ligini de kapatır; sıralama dondurulur, XP yazılmaz.
- **Metrikler:** Yönetici metriklerinin lig listesinde arkadaş ligleri yok (küçük ve özel); toplam aktivite sayılarına emirler dahil.
- **Kabul edilen risk (K-018):** Çoklu hesap ve arkadaş ligi ile kendi kendine lig kurmak mümkün; XP, rozet ve görev ödülü olmadığından kazanç yok, dolayısıyla bu özellik çoklu hesap riskini büyütmez. Tek etki, arkadaş ligindeki emirlerin seri ve emir görevlerine sayılması; bunlar normal ligde de aynı kolaylıkta.
- **Açık konu:** Üyelikten ayrılma, üye çıkarma ve kurucu devri yok. Yönetici arkadaş ligini silemez. Kullanıcı isimleri sıralamada diğer üyelere görünür (mevcut davranış).
- **Migration:** `0015_friends_leagues_invite_code.sql`: `leagues.invite_code`, `leagues.owner_player_id`, iki CHECK kısıtı.

## K-034 · Kademe ligleri: haftalık gruplar, yükselme ve düşme

- **Amaç:** Oyuncuya haftalık tekrar eden, kendi seviyesindekilerle yarıştığı bir hedef vermek (K-017). Kademe yalnızca görünümdür: XP, bakiye ya da sıralama vermez (NFR-06).
- **Kademeler** (kodda sabit, `TIERS`): Bronz, Gümüş, Altın, Platin, Efsane. Yeni oyuncu Bronz'dur (`players.tier`).
- **Gruplar:** Oyuncu `POST /tiers/join` ile bu haftanın (Türkiye takvimiyle pazartesi 00:00 ile sonraki pazartesi) kendi kademesindeki grubuna girer. Grup en fazla 50 kişidir; dolunca aynı kademede yeni grup açılır. Grup bir `leagues` satırıdır (`type = 'tier'`, `tier`, `tier_group`, kontenjan 50, 100.000 TL), yani emir, sıralama, kapanış ve portföy mevcut altyapıyla çalışır. Gruplar oyuncu katıldıkça açılır, önceden oluşturulmaz. Oyuncu grubu seçemez; sunucu yerleştirir. Katılım isteğe bağlıdır: katılmayan kademe değiştirmez.
- **Yükselme ve düşme** (`computeTierMovements`, saf fonksiyon, testli): Kapanışta yalnızca emir vermiş üyeler sayılır. Grupta en az 5 emir veren yoksa kimse hareket etmez. Sayı `floor(n × %20)`: üst dilim bir kademe çıkar, alt dilim bir kademe iner; Efsane'de yükselme, Bronz'da düşme yoktur. Sınırdaki eşit sıralar kotayı aşacaksa o eşitlik grubu tümüyle dışarıda kalır (herkes eşitse kimse hareket etmez). Hiç oynamayan ne yükselir ne düşer.
- **Kapanışla aynı transaction:** `LeagueCloseService` nihai sıralar yazıldıktan sonra `applyTierMovements` çağırır. Her hareket `tier_history (oyuncu, lig)` satırıdır (tekil): aynı kapanış iki kez uygulanamaz. `players.tier` yalnızca hâlâ eski kademedeyse değişir (`WHERE tier = eski`); geç kapanan eski bir hafta güncel kademeyi ezmez, o durumda geçmiş kaydı da yazılmaz.
- **Yerleştirme yarışı:** Yerleştirme (platform, kademe, hafta) başına danışma kilidiyle sıralanır; 60 eşzamanlı katılımda gruplar 50 + 10 olur. Ayrıca `(platform, kademe, hafta başı, grup no)` üzerinde tekil indeks var, kilit kalksa bile çift grup numarası yazılamaz. Aynı hafta ikinci katılım mevcut üyeliği döner, ikinci bakiye verilmez.
- **Görünürlük:** Kademe grubu yalnızca üyesine görünür (arkadaş ligiyle aynı kural, K-033); normal katılım ucu kapalı. Yönetici panelinde salt okunur görünür; metriklerin lig listesinde yok.
- **Diğer ödüllerle ilişki:** Kapanışta lig sırası XP'si normal ligle aynı kuralla verilir (K-011). "Bir lige katıl" görevi kademe grubuna katılmayı saymaz (haftalık görevle haftada bir tıklayarak XP toplanmasın). Podyum rozeti için kademe grubunda en az 5 emir veren oyuncu gerekir (K-030'daki küçük lig açığı bu tür için kapandı).
- **Kabul edilen risk (K-018):** Çoklu hesap kademe yükselmesini büyütür: bir kişi aynı gruba birkaç hesapla girip hesaplardan birini diğerlerinin üstüne çıkarabilir (hesaplar kasten kaybeder). Yerleştirmeyi oyuncu seçemediği için hedef grubu bilemez; yine de 50 kişilik grupta aynı anda katılan hesaplar çoğu zaman aynı gruba düşer. Kazanç yalnızca kademe etiketi, bu yüzden kabul. Pilotta "kimliği doğrulanmış hesap" bilgisi gelince kademe katılımına koşul olabilir.
- **Açık konular:** Yükselen oyuncu, yeni kademede önceki haftadan kalan bakiyeyle değil yeniden 100.000 TL ile başlar (haftalık sıfırlama). Kademeye özel ödül yoktur. Kademe düşüşünü durduran bir koruma (ilk hafta gibi) yok. Yönetici kademe kurallarını (%20, 50 kişi, 5 katılımcı) panelden değiştiremez; kodda sabit.
- **Migration:** `0016_tier_leagues.sql`: `league_type` değeri `tier`, `leagues.tier` ve `tier_group`, `players.tier`, `tier_history`, CHECK kısıtları ve grup tekil indeksi.

## K-035 · CSV dışa aktarma

- **Amaç (FR-25):** Platformun lig sonuçlarını ve modülün etkisini kendi araçlarında (e-tablo, raporlama) kullanabilmesi.
- **Ne dışa aktarılır:** İki dosya. (1) **Lig sıralaması:** kapanmış bir ligin nihai sırası (`sira`, `oyuncu_kimligi`, `toplam_deger`, `getiri_yuzde`, `verilen_xp`). Kapanmış ligde veri donmuştur (FR-32), bu yüzden dosya her indirmede aynıdır. (2) **Metrikler:** panelin toplamları ve lig satırları (`bolum`, `ad`, `deger`), son 7, 30 ya da 90 gün. Oyuncu bazlı etkinlik (emir dökümü) yok: kişisel veri riskini ve dosya boyutunu büyütür, platform isterse ayrı karar olur.
- **Oyuncu adı dosyaya girmez (NFR-04):** Oyuncu yalnızca platformdaki takma kimliğiyle (`externalId`) yer alır. `displayName` platformdan gelen serbest bir alan ve gerçek ad olabilir; dosya panelin dışına çıkar (e-posta, paylaşım), panelde yetkiyle görülen veriyle aynı risk değildir. Platform kendi oyuncusunu takma kimlikten kendi sisteminde çözer. Ad istenirse ayrı karar ve ayrı ayar olur.
- **Kimler indirir:** Yalnızca sahip ve düzenleyici. İzleyici paneli görür ama dosya alamaz. Uçlar `GET /admin/export/leagues/:id/ranking` ve `GET /admin/export/metrics?days=`.
- **Hangi ligler:** Yalnızca kapanmış haftalık ve sezon ligleri. Kapanmamış lig 409, arkadaş ve kademe ligleri 404 (üyelerine özeldir, K-033 ve K-034; yönetici panelinde salt okunur görünür ama sıralaması dışarı çıkmaz). Başka platformun ligi "yok" ile aynı 404 döner (NFR-03).
- **Denetim (K-019):** Her başarılı dışa aktarım `export.created` olarak yazılır (tür, satır sayısı, lig ya da dönem, kim, hangi IP). Sıralama dosyasında okuma ve kayıt tek transaction'dadır; kayıt yazılamazsa dosya verilmez. Reddedilen istekler (rol yetmiyor, lig yok, kapanmamış) dosya çıkmadığı için kayıt yazmaz.
- **Satır sınırı:** Bir dosya en fazla 50.000 veri satırı. Aşan lig sessizce kırpılmaz, 409 ile reddedilir: eksik bir sıralama dosyası yanıltıcıdır. Sınır `EXPORT_MAX_ROWS` ile enjekte edilir (testte 3).
- **CSV enjeksiyonu:** Dosya e-tabloda açılır; `=`, `+`, `-`, `@`, sekme ve CR ile başlayan metin hücresinin başına tek tırnak konur (`csvCell`). Takma kimlik platformdan, lig adı yöneticiden geldiği için ikisi de metin sayılır. Sayı hücreleri (negatif getiri dahil) korunmaz, çünkü biçimi sunucu üretir. Virgül, tırnak ve satır sonu RFC 4180'e göre tırnaklanır.
- **Biçim:** UTF-8 BOM (Excel Türkçe karakteri doğru açsın), virgül ayırıcı, CRLF, ondalık nokta. Başlıklar ASCII (`sira`, `oyuncu_kimligi`), makine okuması kolay olsun. Türkiye yerel ayarlı Excel'de virgül ayırıcı tek sütunda açılabilir; "Veri > Metinden sütunlara" gerekir. Pilotta platform ayırıcı ister ya da kendi aracıyla okursa ayrı karar.
- **Mimari:** `apps/api/src/exports/` (`ExportsService`, `ExportsController`), `packages/shared/src/csv.ts` (`csvCell`, `toCsv`, sabitler). Metrik dosyası `MetricsService.report`'u kullanır (sayılar panelle aynı kaynaktan). Yeni migration yok: denetim eylemi metin olarak saklanır.
- **Açık konular:** Dosya içeriği imzalı değil (indirenin kaydı denetimde, dosyanın kendisi doğrulanamaz). Büyük ligler için akış (stream) yok, dosya bellekte üretilir; 50.000 satır sınırı bunu sınırlar. Oyuncu etkinliği ve oyuncu adı dışa aktarımı yapılmadı.

## K-036 · Karşılıksız tahmin ve AI koç ertelendi, Faz 3 kapandı

- **Karar:** Faz 3'ün son iki maddesi (karşılıksız günlük tahmin, AI koç) yapılmadan Faz 3 kapatıldı. İptal değil, ertelendi.
- **Karşılıksız günlük tahmin (K-017):** Gün sonu fiyat yönü tahmini, doğruysa az XP. "Kumar ya da bahis sayılır mı" sorusunun hukuki cevabı yok. Cevap gelmeden yazılan kod boşa gidebilir. **Geri açma koşulu:** hukukçudan yazılı cevap. Cevap olumluysa tasarım (günde 1, kayıp yok, yalnızca XP) K-017'deki haliyle uygulanır.
- **AI koç (FR-11):** Ucu açık sorular (hangi LLM ve nerede çalışacağı, veri akışı, al/sat filtresi, maliyet, yatırım danışmanlığı sınırı) pilot müşteri olmadan cevaplanamıyor. Önce tasarım dokümanı yazmak da varsayıma dayanırdı. Yatırım tavsiyesi çizgisine en yakın özellik olduğu için erken eklemek getirisinden riskli. **Geri açma koşulu:** bir pilot müşterinin açık talebi. O zaman önce tasarım dokümanı (veri akışı, al/sat filtresi, yanıt kaydı, kapatma ve kullanım sınırı, hukuk soruları), sonra kod.
- **Değişmeyenler:** Ödül yalnızca XP ve görünüm (NFR-06, FR-24). Kişiye özel al/sat önerisi yok. Bu iki özelliğin hiçbiri için şema ya da kod eklenmedi.
- **Sonraki:** Faz 3.5 (pilot entegrasyonu).
