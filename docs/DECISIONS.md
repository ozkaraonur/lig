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
- **Karar:** Node.js 24 LTS, TypeScript 5.9, NestJS 11, Next.js 16, Vitest 3, ESLint 9. Bütün sürümler tam sabit (`^` yok).
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
