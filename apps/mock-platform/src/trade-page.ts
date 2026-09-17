/**
 * Sahte platformun "gerçek işlem ekranı". Lig modülündeki "Gerçek hesabıma geç" butonu (FR-08) buraya
 * yönlendirir. Buradaki işlem, lig API'sine imzalı webhook olarak bildirilir (FR-31).
 */
export const TRADE_PAGE_HTML = `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sahte Platform · İşlem</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #0d0f14; color: #eef1f6; }
    main { max-width: 420px; margin: 48px auto; padding: 0 20px; display: flex; flex-direction: column; gap: 16px; }
    p { color: #8d96a8; margin: 0; line-height: 1.5; }
    label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
    input { font: inherit; padding: 12px; border-radius: 10px; border: 1px solid #2a3140; background: #161a22; color: inherit; }
    button { font: inherit; font-weight: 700; padding: 14px; border-radius: 12px; border: 0; background: #c6f24e; color: #0d0f14; cursor: pointer; }
    button.secondary { background: transparent; color: #eef1f6; border: 1px solid #2a3140; }
    pre { background: #161a22; padding: 12px; border-radius: 10px; white-space: pre-wrap; word-break: break-all; font-size: 12px; min-height: 3em; }
  </style>
</head>
<body>
  <main>
    <h1>Gerçek işlem</h1>
    <p>Burası platformun kendi alım satım ekranı olurdu. Butona basınca lig modülüne "bu oyuncu gerçek işlem yaptı" bildirimi gider.</p>
    <form id="trade">
      <label>Oyuncu kimliği (girişte kullandığın) <input name="externalId" value="oyuncu-1" required pattern="[A-Za-z0-9_.:\\-]{1,128}"></label>
      <button type="submit">Gerçek işlem yap (sahte)</button>
    </form>
    <button type="button" class="secondary" id="replay">Son bildirimi tekrar gönder</button>
    <pre id="result" aria-live="polite"></pre>
  </main>
  <script src="/trade.js"></script>
</body>
</html>`;

export const TRADE_PAGE_SCRIPT = `
const form = document.getElementById('trade');
const result = document.getElementById('result');

async function show(res) {
  const data = await res.json().catch(() => ({}));
  result.textContent = JSON.stringify(data, null, 2);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const externalId = String(new FormData(form).get('externalId') || '').trim();
  result.textContent = 'Gönderiliyor...';
  await show(await fetch('/players/' + encodeURIComponent(externalId) + '/real-trades', { method: 'POST' }));
});

document.getElementById('replay').addEventListener('click', async () => {
  result.textContent = 'Gönderiliyor...';
  await show(await fetch('/debug/webhooks/replay-last', { method: 'POST' }));
});
`;
