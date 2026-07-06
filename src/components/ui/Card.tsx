interface CardProps {
  children: React.ReactNode;
  className?: string;
  elevated?: boolean;
}

export function Card({ children, className = '', elevated = true }: CardProps) {
  return (
    <div
      className={`rounded-xl border border-hair bg-white/90 px-4 py-4 backdrop-blur-sm transition-colors duration-150 ${
        elevated ? 'shadow-[0_20px_50px_-30px_rgba(23,23,23,0.12)]' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}
