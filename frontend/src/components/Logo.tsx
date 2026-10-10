export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative grid h-9 w-9 place-items-center rounded-xl bg-brand shadow-glow">
        <span className="font-display text-[13px] font-extrabold tracking-tighter text-white">F1Z</span>
      </div>
      {!compact && (
        <div className="leading-none">
          <div className="font-display text-[15px] font-extrabold tracking-tight">
            F1Z <span className="text-gradient">PRIME</span>
          </div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">digital store</div>
        </div>
      )}
    </div>
  )
}
