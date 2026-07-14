import { HfInference } from '@huggingface/inference';

// Serverless Inference API is free to use but rate-limited.
// To use it, you must have HUGGINGFACE_API_KEY in your .env.local
const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

/**
 * Generates text using Llama-3.1-8B-Instruct via Hugging Face Serverless API.
 * Verified working with HF router chat completions endpoint on free tier.
 */
export async function generateContentHF(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    throw new Error('HUGGINGFACE_API_KEY is not configured in .env.local');
  }

  // Combine system prompt and user prompt in chat format
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  // Mistral-Nemo-Instruct-2407 is not a chat model on HF router (/v1/chat/completions returns 400).
  // Llama-3.1-8B-Instruct is verified working on HF router with chat completions endpoint.
  const response = await hf.chatCompletion({
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    messages,
    max_tokens: 1024,
    temperature: 0.7,
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from Hugging Face API');
  
  return content;
}

/**
 * Generates an image using FLUX.1-schnell via Hugging Face Serverless API.
 * This is currently the best open-source model for photorealistic AI influencers.
 */
export async function generateImageHF(prompt: string): Promise<Blob | string | any> {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    throw new Error('HUGGINGFACE_API_KEY is not configured in .env.local');
  }

  const response = await hf.textToImage({
    model: 'black-forest-labs/FLUX.1-schnell',
    inputs: prompt,
    parameters: {
      num_inference_steps: 4, // Schnell only needs 4 steps for optimal quality!
    }
  });

  return response; // Returns a Blob containing the image data
}

/**
 * Generates embeddings using all-MiniLM-L6-v2 via Hugging Face Serverless API.
 * Used for Semantic Retrieval (matching hooks, etc).
 */
export async function generateEmbeddingsHF(text: string): Promise<number[]> {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    throw new Error('HUGGINGFACE_API_KEY is not configured in .env.local');
  }

  const response = await hf.featureExtraction({
    model: 'sentence-transformers/all-MiniLM-L6-v2',
    inputs: text,
  });

  // Depending on the model, it may return a nested array.
  // all-MiniLM-L6-v2 usually returns a flat array of numbers (1D) or a 2D array if multiple inputs.
  const embeddings = Array.isArray(response[0]) ? (response[0] as number[]) : (response as number[]);
  return embeddings;
}

/**
 * Transcribes audio using Whisper via Hugging Face Serverless API.
 * nvidia/canary-1b has no live Inference Provider (nemo lib, not router-servable) -
 * that's why prod transcription failed. whisper-large-v3-turbo has a live
 * hf-inference provider on the free tier.
 */
export async function transcribeAudioHF(audioBlob: Blob): Promise<string> {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    throw new Error('HUGGINGFACE_API_KEY is not configured in .env.local');
  }

  const response = await hf.automaticSpeechRecognition({
    model: 'openai/whisper-large-v3-turbo',
    data: audioBlob,
  });

  if (!response || !response.text) {
    throw new Error('Empty transcription response from Hugging Face API');
  }

  return response.text;
}

export interface AiLikelihoodResult {
  /** P(AI) in [0,1]. */
  score: number;
  /** Which detector actually produced the score. */
  detector: 'desklib' | 'heuristic';
}

/**
 * AI-text likelihood via desklib/ai-text-detector-v1.01 (DeBERTa-v3, RAID leader
 * 2026). Returns { score: P(AI) in [0,1], detector } so the mining gate
 * (spec 2.3.4) always knows the provenance and can never silently no-op.
 *
 * Any detector failure (missing key, API error, non-array response,
 * unrecognized label set - seen conventions: "AI"/"Human", "LABEL_1"/"LABEL_0")
 * is logged via console.error and falls back to the deterministic
 * heuristicAiScore path from humanizer.ts, normalized to 0-1, tagged
 * detector: 'heuristic'. Imported lazily to avoid the static cycle
 * huggingface -> humanizer -> llm -> huggingface.
 */
export async function aiTextLikelihood(text: string): Promise<AiLikelihoodResult> {
  const fallback = async (reason: string): Promise<AiLikelihoodResult> => {
    console.error(`aiTextLikelihood: falling back to heuristic detector: ${reason}`);
    const { heuristicAiScore } = await import('./humanizer');
    return { score: heuristicAiScore(text) / 100, detector: 'heuristic' };
  };

  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) return fallback('HUGGINGFACE_API_KEY not configured');
  try {
    const out = (await hf.textClassification({
      model: 'desklib/ai-text-detector-v1.01',
      inputs: text.slice(0, 4000),
    })) as Array<{ label: string; score: number }>;
    if (!Array.isArray(out)) {
      return fallback(`unexpected response shape from desklib detector: ${JSON.stringify(out)}`);
    }
    const ai = out.find((r) => /ai|machine|generated|fake|label_1/i.test(r.label));
    if (ai) return { score: ai.score, detector: 'desklib' };
    // Only a human/real label came back -> AI prob is its complement.
    const human = out.find((r) => /human|real|label_0/i.test(r.label));
    if (human) return { score: 1 - human.score, detector: 'desklib' };
    return fallback(`unrecognized label set from desklib detector: ${JSON.stringify(out.map((r) => r.label))}`);
  } catch (err) {
    return fallback(`desklib API error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
