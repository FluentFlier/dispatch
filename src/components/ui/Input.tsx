import { forwardRef, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', ...rest }, ref) => {
    return (
      <input
        ref={ref}
        className={`w-full rounded-lg border border-hair bg-white px-3 py-2 text-[13px] font-body text-ink placeholder:text-ink3 focus:border-blue/40 focus:outline-none ${className}`}
        {...rest}
      />
    );
  },
);

Input.displayName = 'Input';
export { Input };
