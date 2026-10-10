import type { Me } from '../lib/types'

export function Avatar({ me, size = 44 }: { me?: Me; size?: number }) {
  const letter = (me?.first_name || me?.username || 'F').slice(0, 1).toUpperCase()
  return (
    <div className="relative shrink-0 rounded-full bg-brand p-[2px]" style={{ width: size, height: size }}>
      {me?.photo_url ? (
        <img src={me.photo_url} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center rounded-full bg-surface font-display text-base font-bold text-ink">
          {letter}
        </div>
      )}
      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg bg-success" />
    </div>
  )
}
