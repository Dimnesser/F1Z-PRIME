export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-10 w-10 shrink-0 rounded-full bg-brand p-[2px] shadow-glow">
        <img src="/brand.jpg" alt="F1Z PRIME" className="h-full w-full rounded-full object-cover" />
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
