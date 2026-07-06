interface Props {
  index: string;
  label: string;
  tone?: 'flame' | 'coral';
  className?: string;
}

/** Consistent mono section label: `01 / HERO` */
export default function SectionEyebrow({
  index,
  label,
  tone = 'flame',
  className = '',
}: Props) {
  const color = tone === 'coral' ? 'text-[#FF7A5C]' : 'text-flame';

  return (
    <span
      className={`font-mono text-[11.5px] tracking-[0.12em] ${color} ${className}`}
    >
      {index} / {label}
    </span>
  );
}
