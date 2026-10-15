import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { MessageSquareHeart, Star } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib/api'
import type { OrderDetail } from '../lib/types'
import { useToast } from './Toast'
import { Button } from './ui'

const LABELS = ['', 'Плохо', 'Так себе', 'Нормально', 'Хорошо', 'Отлично']

/** Rating + optional comment for a received order; shows the saved review with an edit action. */
export default function ReviewCard({ order }: { order: OrderDetail }) {
  const qc = useQueryClient()
  const toast = useToast()
  const saved = order.review
  const [editing, setEditing] = useState(!saved)
  const [rating, setRating] = useState(saved?.rating ?? 0)
  const [text, setText] = useState(saved?.text ?? '')
  const [sending, setSending] = useState(false)

  const submit = async () => {
    if (!rating || sending) return
    setSending(true)
    try {
      await api.review(order.id, rating, text.trim())
      toast(saved ? 'Отзыв обновлён' : 'Спасибо за отзыв!', 'success')
      setEditing(false)
      await qc.invalidateQueries({ queryKey: ['order'] })
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSending(false)
    }
  }

  if (saved && !editing) {
    return (
      <section className="card p-4" aria-label="Ваш отзыв">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold">
            <MessageSquareHeart className="h-4 w-4 text-primary" /> Ваш отзыв
          </h2>
          {order.review_allowed && (
            <button type="button" className="text-[12.5px] font-semibold text-primary" onClick={() => setEditing(true)}>
              Изменить
            </button>
          )}
        </div>
        <Stars value={saved.rating} />
        {saved.text && <p className="mt-2 whitespace-pre-line break-words text-[13.5px] leading-relaxed text-ink/85">{saved.text}</p>}
      </section>
    )
  }

  return (
    <section className="card p-4" aria-label="Оставить отзыв">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold">
        <MessageSquareHeart className="h-4 w-4 text-primary" /> Как вам покупка?
      </h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        Оцените заказ и, если хотите, напишите пару слов — это помогает магазину стать лучше.
      </p>
      <Stars value={rating} onChange={setRating} />
      <p className="mt-1 h-4 text-[12px] text-muted">{LABELS[rating]}</p>
      <textarea
        className="mt-3 min-h-[88px] w-full resize-y rounded-[14px] border border-line bg-ov/[0.04] px-3 py-2.5 text-[14px] text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
        maxLength={1000}
        placeholder="Комментарий (необязательно)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Комментарий к отзыву"
      />
      <div className="mt-3 flex gap-2">
        <Button size="md" className="flex-1" loading={sending} disabled={!rating} onClick={submit}>
          {saved ? 'Сохранить' : 'Отправить отзыв'}
        </Button>
        {saved && (
          <Button size="md" variant="ghost" disabled={sending}
            onClick={() => { setRating(saved.rating); setText(saved.text); setEditing(false) }}>
            Отмена
          </Button>
        )}
      </div>
    </section>
  )
}

function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="mt-3 flex gap-1.5" role={onChange ? 'radiogroup' : 'img'}
      aria-label={onChange ? 'Оценка от 1 до 5' : `Оценка ${value} из 5`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const icon = <Star className={clsx('h-7 w-7', n <= value ? 'fill-amber-400 text-amber-400' : 'text-muted/40')} />
        return onChange ? (
          <button key={n} type="button" role="radio" aria-checked={n === value} aria-label={`${n} из 5`}
            className="rounded-lg p-0.5 transition active:scale-90" onClick={() => onChange(n)}>
            {icon}
          </button>
        ) : <span key={n}>{icon}</span>
      })}
    </div>
  )
}
