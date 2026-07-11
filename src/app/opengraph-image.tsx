import { ImageResponse } from 'next/og';
import { PRODUCT_NAME } from '@/lib/brand';

export const runtime = 'edge';
export const alt = PRODUCT_NAME;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Dynamic OG card so social previews never 404 on /og.png.
 */
export default function OpenGraphImage(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px',
          background: '#f7f4ec',
          color: '#24211e',
          fontFamily: 'system-ui, sans-serif',
          border: '1px solid #ded8ca',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              background: '#315fe8',
              color: '#f7f4ec',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 28,
              fontWeight: 700,
            }}
          >
            C
          </div>
          <span style={{ fontSize: 28, fontWeight: 650 }}>
            {PRODUCT_NAME}
          </span>
        </div>
        <div>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 0.95, letterSpacing: '-0.055em', maxWidth: 900 }}>
            One system. More momentum.
          </div>
          <div style={{ marginTop: 28, fontSize: 27, color: '#615c54', maxWidth: 820 }}>
            Create, publish, reply, and learn in one connected loop.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
