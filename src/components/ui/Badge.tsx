interface BadgeProps {
  count: number;
  max?: number;
}

export function Badge({ count, max = 99 }: BadgeProps) {
  const display = count > max ? `${max}+` : String(count);

  return (
    <span
      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-2xs font-semibold"
      style={{
        backgroundColor: "var(--bg-active)",
        color: "var(--text-secondary)",
      }}
    >
      {display}
    </span>
  );
}
