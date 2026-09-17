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
