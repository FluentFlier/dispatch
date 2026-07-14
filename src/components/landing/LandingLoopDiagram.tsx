'use client';

import { useReducedMotion } from 'motion/react';
import { LOOP_STEPS } from './editorial/data';

/** Five-node loop diagram - visual thread for the product story. */
export default function LandingLoopDiagram({ className = '' }: { className?: string }) {
  const reduce = useReducedMotion();

  return (
    <div
      className={`relative hidden aspect-square w-full max-w-[280px] lg:block ${className}`}
      aria-hidden
    >
      <svg viewBox="0 0 200 200" className="h-full w-full" fill="none">
        <circle
          cx="100"
          cy="100"
          r="72"
          stroke="rgba(23,23,23,0.08)"
          strokeWidth="1"
          strokeDasharray="4 6"
        />
        {!reduce && (
          <circle
            cx="100"
            cy="100"
            r="72"
            stroke="url(#loopGrad)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="60 392"
            className="origin-center animate-[spin_24s_linear_infinite]"
          />
        )}
        <defs>
          <linearGradient id="loopGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2563EB" />
            <stop offset="50%" stopColor="#0F766E" />
            <stop offset="100%" stopColor="#E8543A" />
          </linearGradient>
        </defs>
        {LOOP_STEPS.map((step, i) => {
          const angle = (i / LOOP_STEPS.length) * Math.PI * 2 - Math.PI / 2;
          const x = 100 + Math.cos(angle) * 72;
          const y = 100 + Math.sin(angle) * 72;
          return (
            <g key={step.num}>
              <circle cx={x} cy={y} r="14" fill="white" stroke="rgba(23,23,23,0.1)" strokeWidth="1" />
              <circle cx={x} cy={y} r="5" fill={step.accent} />
              <text
                x={x}
                y={y + 26}
                textAnchor="middle"
                className="fill-ink3 text-[7px] font-mono uppercase tracking-wider"
              >
                {step.label}
              </text>
            </g>
          );
        })}
        <text
          x="100"
          y="104"
          textAnchor="middle"
          className="fill-ink2 text-[9px] font-medium"
        >
          loop
        </text>
      </svg>
      <div className="pointer-events-none absolute inset-0 rounded-full bg-blue/5 blur-3xl" />
    </div>
  );
}
