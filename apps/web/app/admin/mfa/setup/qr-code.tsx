import qrcode from 'qrcode-generator';

/**
 * QR kod tarayıcıda çizilir. İçinde MFA secret'ı olduğu için dışarıdaki bir QR servisine gönderilmez;
 * HTML metni de basılmaz, React SVG elemanları kullanılır.
 */
export function QrCode({ value, size = 220 }: { value: string; size?: number }) {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  const margin = 4;
  const total = count + margin * 2;
  const cells: string[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) cells.push(`M${col + margin} ${row + margin}h1v1h-1z`);
    }
  }
  return (
    <svg
      className="qr"
      role="img"
      aria-label="Doğrulama uygulamasına okutulacak QR kod"
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
    >
      <rect width={total} height={total} fill="#fff" />
      <path d={cells.join('')} fill="#000" />
    </svg>
  );
}
