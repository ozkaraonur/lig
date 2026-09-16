## Ne değişti

<!-- Kısa açıklama. İlgili gereksinim kodları: FR-xx, NFR-xx -->

## Nasıl test edildi

- [ ] `npm run check` geçiyor
- [ ] Yeni davranış için test yazıldı
- [ ] Şema değiştiyse `npm run db:generate` ile migration üretildi

## Güvenlik

- [ ] Kullanıcı girdisi doğrulanıyor (zod)
- [ ] Tenant ayrımı korunuyor: sorgular tenant_id ile sınırlı
- [ ] Log ve hata mesajlarında secret ya da kişisel veri yok
