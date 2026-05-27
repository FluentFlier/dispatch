interface CardProps {
  children: React.ReactNode;
  className?: string;
  elevated?: boolean;
}

export function Card({ children, className = '', elevated = true }: CardProps) {
  return (
    <div
      className={`bg-bg-secondary rounded-lg border border-border px-4 py-4 transition-colors duration-150 ${
        elevated ? 'shadow-card' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}
