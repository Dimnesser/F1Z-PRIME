import type { Me } from '../lib/types'

export function Avatar({ me, size = 44 }: { me?: Me; size?: number }) {
  const letter = (me?.first_name || me?.username || 'F').slice(0, 1).toUpperCase()
  return (
    <div className="relative shrink-0 rounded-full bg-gradient-to-br from-primary to-accent p-[2px]" style={{ width: size, height: size }}>
      {me?.photo_url ? (
        <img src={me.photo_url} alt="" className="h-full w-full rounded-full bg-surface object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center rounded-full bg-surface font-bold text-ink" style={{ fontSize: size * 0.38 }}>
          {letter}
        </div>
      )}
    </div>
  )
}
