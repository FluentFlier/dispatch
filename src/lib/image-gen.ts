import { writeFile } from 'node:fs/promises';
import { generateImageHF } from './huggingface';

export type ImageGenProvider = 'gemini' | 'huggingface';

const GEMINI_IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-2.0-flash-preview-image-generation',
] as const;

function geminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
}

async function generateImageGemini(prompt: string): Promise<Buffer> {
  const apiKey = geminiApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY is not configured');
  }

  let lastError: Error | undefined;

  for (const model of GEMINI_IMAGE_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    });

    if (!res.ok) {
      lastError = new Error(`Gemini ${model} failed (${res.status}): ${await res.text()}`);
      continue;
    }

    const json = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
      }>;
    };

    for (const part of json.candidates?.[0]?.content?.parts ?? []) {
      const data = part.inlineData?.data;
      if (data) return Buffer.from(data, 'base64');
    }

    lastError = new Error(`Gemini ${model} returned no image data`);
  }

  throw lastError ?? new Error('Gemini image generation failed');
}

async function generateImageHuggingface(prompt: string): Promise<Buffer> {
  const blob = await generateImageHF(prompt);
  if (blob instanceof Blob) {
    return Buffer.from(await blob.arrayBuffer());
  }
  if (typeof blob === 'string') {
    return Buffer.from(blob, 'base64');
  }
  throw new Error('Unexpected Hugging Face image response');
}

/** Generate an image using the first configured free/cheap provider. */
export async function generateMarketingImage(
  prompt: string,
  preferred: ImageGenProvider[] = ['gemini', 'huggingface'],
): Promise<{ buffer: Buffer; provider: ImageGenProvider }> {
  const errors: string[] = [];

  for (const provider of preferred) {
    try {
      if (provider === 'gemini' && geminiApiKey()) {
        const buffer = await generateImageGemini(prompt);
        return { buffer, provider };
      }
      if (provider === 'huggingface' && process.env.HUGGINGFACE_API_KEY) {
        const buffer = await generateImageHuggingface(prompt);
        return { buffer, provider };
      }
    } catch (err) {
      errors.push(`${provider}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(
    `No image provider available. Set GEMINI_API_KEY or HUGGINGFACE_API_KEY. ${errors.join(' | ')}`,
  );
}

export async function writeMarketingImage(
  prompt: string,
  outputPath: string,
  preferred?: ImageGenProvider[],
): Promise<ImageGenProvider> {
  const { buffer, provider } = await generateMarketingImage(prompt, preferred);
  await writeFile(outputPath, buffer);
  return provider;
}
