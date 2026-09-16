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
- **Karar:** TypeScript 5.9, NestJS 11, Next.js 16, Vitest 3, ESLint 9. Bütün sürümler tam sabit (`^` yok).
- **Sonuç:** Öngörülebilir kurulum. Güncellemeler Dependabot PR'larıyla, testler geçtikten sonra alınır. Ana sürüm yükseltmeleri ayrı iş olarak planlanır.

## K-004 · API sunucusu Fastify

- **Karar:** NestJS, Express yerine Fastify adaptörüyle çalışır. Güvenlik başlıkları `@fastify/helmet`, istek gövdesi 64 KB ile sınırlı.
- **Sonuç:** Daha yüksek istek kapasitesi (NFR-01). Fastify sürümü NestJS'in beklediği sürüme sabitlenir; iki farklı Fastify kopyası tip hatası verir.
