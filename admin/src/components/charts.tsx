import { useMemo, useRef, useState } from 'react'
import { compactMoney, dateShort, num } from '../lib/api'

interface Point { date: string; value: number }

/** Responsive SVG area chart with hover/touch tooltip (no chart library — keeps the bundle small). */
export function AreaChart({ data, color = '#8B5CF6', format = (v: number) => num(v), height = 220 }: {
  data: Point[]; color?: string; format?: (v: number) => string; height?: number
}) {
  const ref = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const W = 640, H = height, PX = 8, PT = 16, PB = 26
  const max = Math.max(1, ...data.map((d) => d.value))
  const nice = useMemo(() => {
    const p = Math.pow(10, Math.floor(Math.log10(max)))
    return Math.ceil(max / p) * p
  }, [max])
  const x = (i: number) => PX + (data.length <= 1 ? 0 : (i / (data.length - 1)) * (W - PX * 2))
  const y = (v: number) => PT + (1 - v / nice) * (H - PT - PB)
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ')
  const area = data.length ? `${line} L${x(data.length - 1)},${H - PB} L${x(0)},${H - PB} Z` : ''
  const gid = `g${color.replace('#', '')}`
  const step = Math.max(1, Math.ceil(data.length / 6))

  const onMove = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r || !data.length) return
    const rel = ((clientX - r.left) / r.width) * W
    const i = Math.round(((rel - PX) / (W - PX * 2)) * (data.length - 1))
    setHover(Math.max(0, Math.min(data.length - 1, i)))
  }
  const h = hover !== null ? data[hover] : null
  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full touch-pan-y select-none" preserveAspectRatio="none"
        style={{ height }} onMouseMove={(e) => onMove(e.clientX)} onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => onMove(e.touches[0].clientX)} onTouchMove={(e) => onMove(e.touches[0].clientX)} onTouchEnd={() => setHover(null)}>
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={PX} x2={W - PX} y1={y(nice * f)} y2={y(nice * f)} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        ))}
        {area && <path d={area} fill={`url(#${gid})`} />}
        {line && <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
        {hover !== null && h && (
          <line x1={x(hover)} x2={x(hover)} y1={PT} y2={H - PB} stroke="rgba(255,255,255,0.25)" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {/* labels outside the stretched SVG so text isn't distorted */}
      <div className="pointer-events-none absolute right-0 top-0 text-[10.5px] text-muted">{format(nice)}</div>
      <div className="mt-1 flex justify-between text-[10.5px] text-muted">
        {data.filter((_, i) => i % step === 0 || i === data.length - 1).map((d) => <span key={d.date}>{dateShort(d.date)}</span>)}
      </div>
      {hover !== null && h && (
        <div className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-xl border border-white/10 bg-elevated px-3 py-2 text-xs shadow-pop"
          style={{ left: `${Math.min(88, Math.max(12, (x(hover) / W) * 100))}%` }}>
          <div className="text-muted">{dateShort(h.date)}</div>
          <div className="tabular font-bold">{format(h.value)}</div>
        </div>
      )}
    </div>
  )
}

export function MiniBars({ data, color = '#22D3EE', height = 120 }: { data: Point[]; color?: string; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {data.map((d) => (
        <div key={d.date} title={`${dateShort(d.date)}: ${d.value}`} className="group relative flex-1 rounded-t-[3px] transition-opacity hover:opacity-100"
          style={{ height: `${Math.max(3, (d.value / max) * 100)}%`, background: color, opacity: d.value ? 0.75 : 0.15 }} />
      ))}
    </div>
  )
}

export function BarList({ items, format = (v: number) => compactMoney(v) }: { items: { label: string; value: number; sub?: string }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="space-y-3">
      {items.map((i) => (
        <div key={i.label}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-semibold">{i.label}</span>
            <span className="tabular shrink-0 text-muted">{i.sub && <span className="mr-2 text-xs">{i.sub}</span>}<span className="font-semibold text-ink">{format(i.value)}</span></span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-[width] duration-500" style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
