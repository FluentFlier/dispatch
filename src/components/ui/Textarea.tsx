import { forwardRef, type TextareaHTMLAttributes } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  className?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = '', rows = 4, ...rest }, ref) => {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={`w-full resize-none rounded-lg border border-hair bg-white px-3 py-2 text-[13px] font-body text-ink placeholder:text-ink3 focus:border-blue/40 focus:outline-none ${className}`}
        {...rest}
      />
    );
  },
);

Textarea.displayName = 'Textarea';
export { Textarea };
