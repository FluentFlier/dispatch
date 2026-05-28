'use client';

import Image from 'next/image';
import { useState, useRef, useCallback } from 'react';
import { Upload, X, Loader2, ImageIcon } from 'lucide-react';

interface ImageUploadProps {
  imageUrl: string | null;
  onUpload: (url: string) => void;
  onRemove: () => void;
}

export function ImageUpload({ imageUrl, onUpload, onRemove }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError('');
    setUploading(true);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Upload failed');
        return;
      }

      onUpload(data.url);
    } catch {
      setError('Upload failed. Check your connection.');
    } finally {
      setUploading(false);
    }
  }, [onUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  if (imageUrl) {
    return (
      <div className="relative group">
        <div className="relative h-[200px] w-full overflow-hidden rounded-md border border-border">
        <Image
          src={imageUrl}
          alt="Post media"
          fill
          sizes="(max-width: 768px) 100vw, 640px"
          className="object-cover"
          unoptimized
        />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="absolute top-2 right-2 w-7 h-7 rounded-full bg-bg-primary/80 flex items-center justify-center text-text-secondary hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        disabled={uploading}
        className={`w-full flex flex-col items-center justify-center gap-2 py-6 rounded-md border border-dashed transition-all ${
          dragOver
            ? 'border-accent-primary bg-coral-light'
            : 'border-border bg-bg-tertiary hover:border-border-hover'
        } ${uploading ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {uploading ? (
          <Loader2 size={20} className="text-text-tertiary animate-spin" />
        ) : (
          <ImageIcon size={20} className="text-text-tertiary" />
        )}
        <span className="text-[12px] text-text-secondary">
          {uploading ? 'Uploading...' : 'Drop image or click to upload'}
        </span>
        <span className="text-[10px] text-text-tertiary">JPG, PNG, WebP, GIF. Max 10MB</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleSelect}
        className="hidden"
      />
      {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}
