import clsx from 'clsx'
import { useState } from 'react'

/** Round country flag. Emoji flags render as two letters on Windows (Telegram Desktop), so a real image is used,
 *  with the emoji as a fallback when the image cannot load. */
export function Flag({ code, emoji, size = 40, className }: { code?: string | null; emoji?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  const iso = (code ?? '').toLowerCase()
  const usable = /^[a-z]{2}$/.test(iso) && !failed
  return (
    <span
      className={clsx('relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-ov/[0.06]', className)}
      style={{ width: size, height: size, fontSize: size * 0.62 }}
      aria-hidden
    >
      {usable ? (
        <img
          src={`https://flagcdn.com/w160/${iso}.png`}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full scale-[1.35] object-cover"
        />
      ) : (
        <span className="leading-none">{emoji ?? '🌐'}</span>
      )}
      <span className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-black/10" />
    </span>
  )
}
