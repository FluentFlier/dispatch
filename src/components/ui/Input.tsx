import { forwardRef, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', ...rest }, ref) => {
    return (
      <input
        ref={ref}
        className={`w-full bg-bg-secondary border border-border text-text-primary rounded-md px-3 py-2 text-[13px] font-body placeholder:text-text-tertiary focus:outline-none focus:border-border-hover ${className}`}
        {...rest}
      />
    );
  },
);

Input.displayName = 'Input';
export { Input };
