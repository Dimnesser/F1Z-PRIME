export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/brand.jpg" alt="F1Z PRIME" width={36} height={36} className="h-9 w-9 shrink-0 rounded-[12px] object-cover ring-1 ring-line" />
      {!compact && (
        <div className="leading-none">
          <div className="font-brand text-[14px] font-bold tracking-tight">
            F1Z <span className="text-primary-soft">PRIME</span>
          </div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">digital market</div>
        </div>
      )}
    </div>
  )
}
