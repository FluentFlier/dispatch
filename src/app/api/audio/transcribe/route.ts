import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudioHF } from '@/lib/huggingface';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('audio');

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: 'No valid audio file provided.' },
        { status: 400 }
      );
    }

    // Call the NVIDIA NeMo model via Hugging Face Serverless API
    const text = await transcribeAudioHF(file);

    return NextResponse.json({ text });
  } catch (error: any) {
    console.error('[Transcribe API] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to transcribe audio' },
      { status: 500 }
    );
  }
}
