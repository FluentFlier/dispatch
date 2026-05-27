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
        className={`w-full bg-bg-secondary border border-border text-text-primary rounded-md px-3 py-2 text-[13px] font-body placeholder:text-text-tertiary focus:outline-none focus:border-border-hover resize-none ${className}`}
        {...rest}
      />
    );
  },
);

Textarea.displayName = 'Textarea';
export { Textarea };
