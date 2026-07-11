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
 * nvidia/canary-1b has no live Inference Provider (nemo lib, not router-servable) —
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

/**
 * AI-text likelihood via desklib/ai-text-detector-v1.01 (DeBERTa-v3, RAID leader
 * 2026). Returns P(AI) in [0,1]. Used to keep mined slop out of the hook corpus
 * (spec 2.3.4). Fails OPEN (returns 0 = "looks human") on any API error so a
 * detector outage degrades to "accept" rather than crashing a mining run.
 *
 * Defensive parsing: the Inference API's label convention isn't guaranteed
 * (seen: "AI"/"Human", "LABEL_1"/"LABEL_0"). If a response comes back that
 * matches neither pattern, we log a descriptive warning (so an unrecognized
 * shape is never a *silent* pass) and still return 0 to preserve the fail-open
 * contract required by the mining pipeline.
 */
export async function aiTextLikelihood(text: string): Promise<number> {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) return 0;
  try {
    const out = (await hf.textClassification({
      model: 'desklib/ai-text-detector-v1.01',
      inputs: text.slice(0, 4000),
    })) as Array<{ label: string; score: number }>;
    if (!Array.isArray(out)) {
      console.error(`aiTextLikelihood: unexpected response shape from desklib detector: ${JSON.stringify(out)}`);
      return 0;
    }
    const ai = out.find((r) => /ai|machine|generated|fake|label_1/i.test(r.label));
    if (ai) return ai.score;
    // Only a human/real label came back -> AI prob is its complement.
    const human = out.find((r) => /human|real|label_0/i.test(r.label));
    if (human) return 1 - human.score;
    console.error(`aiTextLikelihood: unrecognized label set from desklib detector: ${JSON.stringify(out.map((r) => r.label))}`);
    return 0;
  } catch {
    return 0;
  }
}
