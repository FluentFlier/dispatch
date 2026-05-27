import { forwardRef, type SelectHTMLAttributes } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  className?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', children, ...rest }, ref) => {
    return (
      <select
        ref={ref}
        className={`bg-bg-secondary border border-border text-text-primary rounded-md px-3 py-2 text-[13px] font-body focus:outline-none focus:border-border-hover ${className}`}
        {...rest}
      >
        {children}
      </select>
    );
  },
);

Select.displayName = 'Select';
export { Select };
