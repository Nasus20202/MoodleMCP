import { describe, expect, it } from 'vitest';

import { embeddedImages, MAX_EMBEDDED_IMAGES } from './embedded-images.ts';

const png = (data: string) => `<img alt="x" src="data:image/png;base64,${data}">`;

describe('embeddedImages', () => {
  it('finds base64 images in order, once each, and unwraps line breaks', () => {
    const html = `<p>a</p>${png('AAAA')}${png('BBBB')}${png('AAAA')}<img src='data:image/jpeg;base64,CC\nCC'>`;
    expect(embeddedImages(html)).toEqual({
      images: [
        { mimeType: 'image/png', base64: 'AAAA' },
        { mimeType: 'image/png', base64: 'BBBB' },
        { mimeType: 'image/jpeg', base64: 'CCCC' },
      ],
      skipped: 0,
    });
  });

  it('ignores other data URIs and ordinary links', () => {
    const html =
      '<img src="data:image/svg+xml;base64,AAAA"><img src="https://x/y.png"><a href="data:text/plain,hi">';
    expect(embeddedImages(html)).toEqual({ images: [], skipped: 0 });
  });

  it('skips an oversized image and those beyond the count limit', () => {
    const big = 'A'.repeat(6 * 1024 * 1024);
    expect(embeddedImages(png(big))).toEqual({ images: [], skipped: 1 });
    const many = Array.from({ length: MAX_EMBEDDED_IMAGES + 2 }, (_, i) =>
      png(`QQ${i}A`.padEnd(8, 'A')),
    ).join('');
    const out = embeddedImages(many);
    expect(out.images).toHaveLength(MAX_EMBEDDED_IMAGES);
    expect(out.skipped).toBe(2);
  });
});
