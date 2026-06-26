import { HfInference } from '@huggingface/inference';

// Serverless Inference API is free to use but rate-limited.
// To use it, you must have HUGGINGFACE_API_KEY in your .env.local
const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

/**
 * Generates text using Mistral-Nemo-Instruct-2407 via Hugging Face Serverless API.
 * Mistral-Nemo is an excellent, large-context free model for following instructions.
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

  // We use mistralai/Mistral-Nemo-Instruct-2407 as our default free generation model
  // It provides a great balance of speed, capability, and instruction following.
  const response = await hf.chatCompletion({
    model: 'mistralai/Mistral-Nemo-Instruct-2407',
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
 * Transcribes audio using NVIDIA NeMo via Hugging Face Serverless API.
 * We use nvidia/canary-1b, an excellent ASR model.
 */
export async function transcribeAudioHF(audioBlob: Blob): Promise<string> {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    throw new Error('HUGGINGFACE_API_KEY is not configured in .env.local');
  }

  const response = await hf.automaticSpeechRecognition({
    model: 'nvidia/canary-1b',
    data: audioBlob,
  });

  if (!response || !response.text) {
    throw new Error('Empty transcription response from Hugging Face API');
  }

  return response.text;
}
