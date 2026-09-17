import { describe, expect, it } from 'vitest';
import { safeHttpUrl } from './drizzle-adapters';

describe('safeHttpUrl (FR-08)', () => {
  it.each(['https://platform.example/trade', 'http://127.0.0.1:4100/trade'])('keeps %s', (url) => {
    expect(safeHttpUrl(url)).toBe(url);
  });

  it.each([
    'javascript:alert(document.cookie)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '//evil.example',
    'not a url',
    '',
    null,
  ])('drops %j', (url) => {
    expect(safeHttpUrl(url)).toBeNull();
  });
});
