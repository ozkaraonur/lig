'use client';

import { accentTextColor, type BrandingView, DEFAULT_PRIMARY_COLOR, readableTextColor } from '@lig/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { adminErrorMessage } from '../admin-errors';
import { AdminShell } from '../admin-shell';

export default function BrandingPage() {
  return (
    <AdminShell>
      {(me) => <Branding canEdit={me.admin.role === 'owner' || me.admin.role === 'editor'} />}
    </AdminShell>
  );
}

const isColor = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value);

function Branding({ canEdit }: { canEdit: boolean }) {
  const [name, setName] = useState('');
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_PRIMARY_COLOR);
  const [logoUrl, setLogoUrl] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<BrandingView>('/admin/branding')
      .then((b) => {
        setName(b.name);
        setPrimaryColor(b.primaryColor);
        setLogoUrl(b.logoUrl ?? '');
        setLoaded(true);
      })
      .catch((e: unknown) => setMessage({ ok: false, text: adminErrorMessage(e) }));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const saved = await apiFetch<BrandingView>('/admin/branding', {
        method: 'PATCH',
        body: JSON.stringify({ name, primaryColor, logoUrl: logoUrl.trim() === '' ? null : logoUrl.trim() }),
      });
      setName(saved.name);
      setPrimaryColor(saved.primaryColor);
      setLogoUrl(saved.logoUrl ?? '');
      setMessage({ ok: true, text: 'Kaydedildi. Oyuncu ekranı yenilendiğinde yeni görünümü alır.' });
    } catch (e) {
      setMessage({ ok: false, text: adminErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const preview = isColor(primaryColor) ? primaryColor : DEFAULT_PRIMARY_COLOR;

  return (
    <>
      <h1>Marka</h1>
      <p>Oyuncu ekranında görünen ad, ana renk ve logo. Yazı rengi renkten hesaplanır.</p>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'ok' : undefined}>
          {message.text}
        </p>
      )}
      {!loaded ? (
        <p>Yükleniyor...</p>
      ) : (
        <form className="card form" onSubmit={submit}>
          <label>
            Platform adı
            <input
              name="name"
              required
              maxLength={40}
              disabled={!canEdit}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="row two">
            <label>
              Ana renk
              <input
                name="primaryColor"
                required
                disabled={!canEdit}
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value.trim())}
              />
            </label>
            <label>
              Renk seçici
              <input
                type="color"
                name="colorPicker"
                aria-label="Renk seçici"
                disabled={!canEdit}
                value={isColor(primaryColor) ? primaryColor : DEFAULT_PRIMARY_COLOR}
                onChange={(e) => setPrimaryColor(e.target.value)}
              />
            </label>
          </div>
          <label>
            Logo adresi (https, boş bırakılabilir)
            <input
              name="logoUrl"
              type="url"
              placeholder="https://..."
              disabled={!canEdit}
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
            />
          </label>
          <div className="card-row">
            <span
              className="swatch"
              data-testid="color-preview"
              style={
                {
                  '--preview-color': preview,
                  '--preview-text': readableTextColor(preview),
                } as React.CSSProperties
              }
            >
              Lige katıl
            </span>
            <span
              className="accent-sample"
              data-testid="text-preview"
              style={{ '--preview-readable': accentTextColor(preview) } as React.CSSProperties}
            >
              1.250 XP
            </span>
            {logoUrl.startsWith('https://') && (
              <img className="brand-logo" src={logoUrl} alt="Logo önizleme" />
            )}
          </div>
          {canEdit ? (
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          ) : (
            <p>Bu ayarları sahip ve düzenleyici değiştirebilir.</p>
          )}
        </form>
      )}
    </>
  );
}
