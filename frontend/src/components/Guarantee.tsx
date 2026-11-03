import { ShieldCheck } from 'lucide-react'
import { useConfig } from '../lib/queries'

/** Guarantee terms from the shop settings (editable in the admin panel). Shown only for listed categories. */
export function useGuarantee(category?: string | null) {
  const { data } = useConfig()
  const s = data?.settings ?? {}
  if (s.guarantee_enabled !== 'true' || !s.guarantee_text) return null
  const cats = (s.guarantee_categories ?? '').split(',').map((c) => c.trim()).filter(Boolean)
  if (category && cats.length && !cats.includes(category)) return null
  return { title: s.guarantee_title || 'Гарантия', text: s.guarantee_text, days: s.guarantee_days }
}

export function GuaranteeCard({ category, compact = false }: { category?: string | null; compact?: boolean }) {
  const g = useGuarantee(category)
  if (!g) return null
  return (
    <div className={compact ? 'flex items-start gap-2.5 rounded-2xl bg-success/[0.07] p-3 ring-1 ring-inset ring-success/20' : 'card flex items-start gap-3 p-4'}>
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-success/12 text-success">
        <ShieldCheck className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0">
        <div className="text-[14px] font-semibold">{g.title}</div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{g.text}</p>
      </div>
    </div>
  )
}
