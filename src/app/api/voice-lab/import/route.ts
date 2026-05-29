import { NextRequest, NextResponse } from 'next/server';
import { lookup } from 'dns/promises';
import { isIP } from 'node:net';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { z } from 'zod';

const ImportSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(10),
});

interface ImportedSample {
  content: string;
  platform: string;
  sourceUrl: string;
  title?: string;
}

function detectPlatform(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  if (host.includes('twitter.com') || host.includes('x.com')) return 'Twitter/X';
  if (host.includes('linkedin.com')) return 'LinkedIn';
  if (host.includes('instagram.com')) return 'Instagram';
  if (host.includes('threads.net')) return 'Threads';
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'YouTube';
  if (host.includes('substack.com')) return 'Substack';
  if (host.includes('medium.com')) return 'Medium';
  return 'Web';
}

function cleanReaderText(raw: string): { title?: string; body: string } {
  const lines = raw
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const titleLine = lines.find((line) => line.startsWith('Title: '));
  const title = titleLine?.replace(/^Title:\s*/, '').trim();

  const body = lines
    .filter((line) => {
      if (/^(Title|URL Source|Markdown Content|Published Time):/i.test(line)) return false;
      if (/^Warning: This is a cached snapshot/i.test(line)) return false;
      if (/^!\[.*\]\(.*\)$/.test(line)) return false;
      if (/^\[.*\]\(.*\)$/.test(line)) return false;
      return true;
    })
    .join('\n')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/[#*_>`]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, body };
}

function chunkSamples(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 80 && part.length <= 4000);

  if (paragraphs.length === 0 && text.length >= 80) {
    return [text.slice(0, 4000)];
  }

  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if ((current + '\n\n' + paragraph).trim().length > 1800 && current) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }

    if (chunks.length >= 4) break;
  }

  if (current && chunks.length < 4) chunks.push(current.trim());
  return chunks.slice(0, 4);
}

function isPrivateIp(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
    if (a === 0) return true;
    return false;
  }

  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::1') return true;
    if (normalized.startsWith('fe80:')) return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('::ffff:127.')) return true;
  }

  return false;
}

async function assertPublicUrl(url: string): Promise<URL> {
  const parsed = new URL(url);

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Private hosts are not allowed');
  }

  if (isIP(hostname) !== 0) {
    if (isPrivateIp(hostname)) throw new Error('Private hosts are not allowed');
    return parsed;
  }

  const records = await lookup(hostname, { all: true, verbatim: true });
  if (records.some((record) => isPrivateIp(record.address))) {
    throw new Error('Private hosts are not allowed');
  }

  return parsed;
}

async function fetchReadable(url: string): Promise<{ title?: string; body: string }> {
  await assertPublicUrl(url);

  const readerUrl = `https://r.jina.ai/${url}`;
  const readerRes = await fetch(readerUrl, {
    headers: { Accept: 'text/plain' },
    next: { revalidate: 0 },
  });

  if (readerRes.ok) {
    const text = await readerRes.text();
    const cleaned = cleanReaderText(text);
    if (cleaned.body.length >= 80) return cleaned;
  }

  const directRes = await fetch(url, {
    headers: {
      Accept: 'text/html,text/plain',
      'User-Agent': 'DispatchVoiceImporter/1.0',
    },
    next: { revalidate: 0 },
  });
  if (!directRes.ok) throw new Error(`Could not read ${url}`);

  const html = await directRes.text();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (body.length < 80) throw new Error(`No readable text found for ${url}`);
  return { title, body };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = ImportSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const samples: ImportedSample[] = [];
  const failures: { url: string; error: string }[] = [];

  for (const url of parsed.data.urls) {
    try {
      const readable = await fetchReadable(url);
      const platform = detectPlatform(url);
      for (const content of chunkSamples(readable.body)) {
        samples.push({
          content,
          platform,
          sourceUrl: url,
          title: readable.title,
        });
      }
    } catch (err) {
      failures.push({
        url,
        error: err instanceof Error ? err.message : 'Import failed',
      });
    }
  }

  return NextResponse.json({
    samples: samples.slice(0, 20),
    failures,
  });
}
