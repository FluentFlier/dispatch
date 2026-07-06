'use client';

import Image from 'next/image';
import { useReducedMotion } from 'motion/react';

interface Props {
  src: string;
  alt?: string;
  height?: 'sm' | 'md';
  className?: string;
}

/** Full-bleed soft image band between sections. */
export default function LandingPhotoBand({
  src,
  alt = '',
  height = 'md',
  className = '',
}: Props) {
  const reduce = useReducedMotion();
  const h = height === 'sm' ? 'h-[140px] sm:h-[180px]' : 'h-[200px] sm:h-[260px]';

  return (
    <div
      className={`relative ${h} w-full overflow-hidden ${className}`}
      aria-hidden={!alt}
    >
      <Image
        src={src}
        alt={alt}
        fill
        className={`object-cover object-center ${reduce ? '' : 'scale-110 animate-land-kenburns'}`}
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-paper via-transparent to-paper" />
      <div className="absolute inset-0 bg-paper/25 backdrop-blur-[2px]" />
    </div>
  );
}
