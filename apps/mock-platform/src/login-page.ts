/**
 * Sahte platformun "uygulamada Ligler sekmesine dokunma" anını taklit eden sayfa.
 * Token URL'nin `#` kısmıyla (fragment) gönderilir: fragment sunucuya gitmez, loglara düşmez.
 * Web uygulaması token'ı okuduktan hemen sonra adres çubuğundan siler.
 */
export const LOGIN_PAGE_HTML = `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sahte Platform</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #0d0f14; color: #eef1f6; }
    main { max-width: 420px; margin: 48px auto; padding: 0 20px; display: flex; flex-direction: column; gap: 16px; }
    p { color: #8d96a8; margin: 0; line-height: 1.5; }
    label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
    input { font: inherit; padding: 12px; border-radius: 10px; border: 1px solid #2a3140; background: #161a22; color: inherit; }
    button { font: inherit; font-weight: 700; padding: 14px; border-radius: 12px; border: 0; background: #c6f24e; color: #0d0f14; cursor: pointer; }
    .error { color: #ff5c7a; min-height: 1.5em; }
    code { color: #c6f24e; }
    .tools { border-top: 1px solid #2a3140; padding-top: 16px; display: flex; flex-direction: column; gap: 10px; }
    .tools button { background: transparent; color: #eef1f6; border: 1px solid #2a3140; }
  </style>
</head>
<body>
  <main data-web-url="__WEB_URL__">
    <h1>Sahte Platform</h1>
    <p>Gerçek bir kripto platformunun yerine geçer. Oyuncu kimliği seç ve lige gir.</p>
    <form id="login">
      <label>Oyuncu kimliği <input name="externalId" value="oyuncu-1" required pattern="[A-Za-z0-9_.:\\-]{1,128}"></label>
      <label>Görünen ad <input name="displayName" value="Deniz" maxlength="40"></label>
      <button type="submit">Ligler sekmesine dokun</button>
    </form>
    <p class="error" id="error" role="alert"></p>
    <p>Token 5 dakika geçerli ve tek kullanımlık. Aynı token ikinci kez kullanılırsa <code>401</code> döner.</p>
    <section class="tools">
      <h2>Test araçları</h2>
      <p>Fiyat akışı: <strong id="feed-status">...</strong></p>
      <button type="button" id="feed-toggle">Fiyat akışını durdur</button>
      <p>Durdurunca 5 saniye sonra ligde fiyatlar "güncel değil" olur ve emir verilemez.</p>
    </section>
  </main>
  <script src="/login.js"></script>
</body>
</html>`;

export const LOGIN_PAGE_SCRIPT = `
const main = document.querySelector('main');
const webUrl = decodeURIComponent(main.dataset.webUrl);
const form = document.getElementById('login');
const errorBox = document.getElementById('error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';
  const data = new FormData(form);
  const externalId = String(data.get('externalId') || '').trim();
  const displayName = String(data.get('displayName') || '').trim();
  try {
    const res = await fetch('/players/' + encodeURIComponent(externalId) + '/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(displayName ? { displayName } : {}),
    });
    if (!res.ok) {
      errorBox.textContent = 'Token alınamadı: kimlik ya da ad geçersiz.';
      return;
    }
    const { token } = await res.json();
    window.location.assign(webUrl + '/auth/callback#token=' + encodeURIComponent(token));
  } catch {
    errorBox.textContent = 'Sahte platforma ulaşılamadı.';
  }
});

const feedStatus = document.getElementById('feed-status');
const feedToggle = document.getElementById('feed-toggle');
let paused = false;

function renderFeed() {
  feedStatus.textContent = paused ? 'durduruldu' : 'akıyor';
  feedToggle.textContent = paused ? 'Fiyat akışını başlat' : 'Fiyat akışını durdur';
}

fetch('/debug/prices').then((r) => r.json()).then((d) => { paused = d.paused; renderFeed(); });

feedToggle.addEventListener('click', async () => {
  const res = await fetch('/debug/prices/' + (paused ? 'resume' : 'pause'), { method: 'POST' });
  paused = (await res.json()).paused;
  renderFeed();
});
`;
