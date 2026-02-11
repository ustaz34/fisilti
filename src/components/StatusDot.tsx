interface StatusDotProps {
  status: "idle" | "recording" | "transcribing";
}

export function StatusDot({ status }: StatusDotProps) {
  if (status === "recording") {
    return (
      <div className="relative flex items-center justify-center w-4 h-4">
        <div className="absolute w-4 h-4 rounded-full bg-[var(--color-accent)] animate-ping opacity-40" />
        <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-accent-hover)] shadow-[0_0_8px_rgba(var(--accent-rgb),0.8)]" />
      </div>
    );
  }

  if (status === "transcribing") {
    return (
      <div className="relative flex items-center justify-center w-4 h-4">
        <div className="w-2.5 h-2.5 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
      </div>
    );
  }

  // idle
  return (
    <div className="relative flex items-center justify-center w-4 h-4">
      <div className="w-2 h-2 rounded-full bg-[var(--color-accent)] opacity-60" />
    </div>
  );
}
