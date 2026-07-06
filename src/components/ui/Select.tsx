import { forwardRef, type SelectHTMLAttributes } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  className?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', children, ...rest }, ref) => {
    return (
      <select
        ref={ref}
        className={`rounded-lg border border-hair bg-white px-3 py-2 text-[13px] font-body text-ink focus:border-blue/40 focus:outline-none ${className}`}
        {...rest}
      >
        {children}
      </select>
    );
  },
);

Select.displayName = 'Select';
export { Select };
