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
          background: 'linear-gradient(145deg, #1C1917 0%, #292524 55%, #3D8B7A 100%)',
          color: '#FAFAF9',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              background: '#FAFAF9',
              color: '#1C1917',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 28,
              fontWeight: 700,
            }}
          >
            /
          </div>
          <span style={{ fontSize: 28, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            {PRODUCT_NAME}
          </span>
        </div>
        <div>
          <div style={{ fontSize: 64, fontWeight: 600, lineHeight: 1.05, letterSpacing: '-0.03em', maxWidth: 900 }}>
            Write in your voice. Ship everywhere.
          </div>
          <div style={{ marginTop: 24, fontSize: 28, color: '#D6D3D1', maxWidth: 820 }}>
            The private content command center for creators who publish consistently.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
