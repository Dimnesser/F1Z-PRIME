import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowRight, Gem, Globe2, Headphones, ShieldCheck, Sparkles, Undo2, Zap } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PremiumCard, ProductMini } from '../components/Cards'
import { TopBar } from '../components/TopBar'
import { SectionHeader, Skeleton, stagger } from '../components/ui'
import { api } from '../lib/api'
import { money } from '../lib/format'
import { useConfig, useCountries, usePremium } from '../lib/queries'

const CAT_ICON: Record<string, typeof Globe2> = { globe: Globe2, gem: Gem, sparkles: Sparkles, zap: Zap }

export default function Home() {
  const navigate = useNavigate()
  const { data: config } = useConfig()
  const { data: countries, isLoading: cLoading } = useCountries()
  const { data: premium, isLoading: pLoading } = usePremium()
  const { data: popular, isLoading: popLoading } = useQuery({ queryKey: ['popular'], queryFn: () => api.products({ popular: true }) })
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: api.categories })
  const s = config?.settings

  return (
    <div className="space-y-7">
      <TopBar />

      {/* Banner */}
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.05 }}
        className="relative overflow-hidden rounded-[30px] bg-brand p-[1.5px] shadow-glow"
      >
        <div className="relative overflow-hidden rounded-[29px] bg-[radial-gradient(120%_120%_at_0%_0%,#2a1858_0%,#120f2a_45%,#0b1a24_100%)] p-5">
          <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 animate-spin-slow rounded-full bg-[conic-gradient(from_0deg,rgba(139,92,246,0.5),rgba(34,211,238,0.4),transparent,rgba(139,92,246,0.5))] opacity-60 blur-2xl" />
          <div className="absolute right-4 top-5 animate-float">
            <div className="h-20 w-20 rounded-full bg-brand p-[2px] shadow-glow-cyan">
              <img src="/brand.jpg" alt="" className="h-full w-full rounded-full object-cover" />
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.15em] text-white/90 ring-1 ring-white/15">
            <Sparkles className="h-3 w-3" /> {s?.shop_name ?? 'F1Z PRIME'}
          </span>
          <h2 className="mt-3 max-w-[210px] font-display text-[22px] font-bold leading-[1.15] text-white">
            {s?.banner_title ?? 'Премиальные цифровые товары'}
          </h2>
          <p className="mt-2 max-w-[260px] text-[13px] leading-snug text-white/70">{s?.banner_subtitle}</p>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate('/catalog')}
            className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-[13.5px] font-bold text-bg"
          >
            Перейти в каталог <ArrowRight className="h-4 w-4" />
          </motion.button>
        </div>
      </motion.div>

      {/* Categories */}
      <section>
        <SectionHeader title="Категории" />
        <div className="grid grid-cols-2 gap-3">
          {(categories ?? [null, null]).map((c, i) =>
            c ? (
              <motion.button
                key={c.slug}
                whileTap={{ scale: 0.96 }}
                onClick={() => navigate(c.slug === 'premium' ? '/numbers' : '/catalog')}
                className="card relative overflow-hidden p-4 text-left"
              >
                <div className="pointer-events-none absolute -bottom-8 -right-8 h-24 w-24 rounded-full bg-primary/15 blur-2xl" />
                {(() => {
                  const Icon = CAT_ICON[c.icon] ?? Sparkles
                  return (
                    <div className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-soft text-primary-soft ring-1 ring-white/10">
                      <Icon className="h-5 w-5" />
                    </div>
                  )
                })()}
                <div className="mt-3 text-[14px] font-bold leading-tight">{c.title}</div>
                <div className="mt-0.5 text-[12px] text-muted">{c.stock} в наличии</div>
              </motion.button>
            ) : (
              <Skeleton key={i} className="h-[118px] rounded-3xl" />
            ),
          )}
        </div>
      </section>

      {/* Popular */}
      <section>
        <SectionHeader title="🔥 Популярное" action="Все" onAction={() => navigate('/catalog')} />
        <motion.div variants={stagger.container} initial="hidden" animate="show" className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar">
          {popLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-[150px] w-[156px] shrink-0 rounded-3xl" />)}
          {popular?.map((p) => <ProductMini key={p.id} p={p} onOpen={() => navigate(`/product/${p.id}`)} />)}
        </motion.div>
      </section>

      {/* Countries */}
      <section>
        <SectionHeader title="🌍 Страны" action="Каталог" onAction={() => navigate('/catalog')} />
        <div className="grid grid-cols-4 gap-2.5">
          {cLoading && Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-2xl" />)}
          {countries?.map((c) => (
            <motion.button
              key={c.id}
              whileTap={{ scale: 0.93 }}
              onClick={() => c.product_id && navigate(`/product/${c.product_id}`)}
              className="flex flex-col items-center rounded-2xl bg-card py-3 ring-1 ring-white/[0.06]"
            >
              <span className="text-[28px] leading-none">{c.flag}</span>
              <span className="mt-1.5 w-full truncate px-1 text-[11.5px] font-semibold">{c.name}</span>
              <span className="text-[11px] font-bold text-primary-soft">{money(c.price)}</span>
            </motion.button>
          ))}
        </div>
      </section>

      {/* Premium */}
      <section>
        <SectionHeader title="💎 Красивые номера" action="Все" onAction={() => navigate('/numbers')} />
        <motion.div variants={stagger.container} initial="hidden" animate="show" className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar">
          {pLoading && [0, 1].map((i) => <Skeleton key={i} className="h-[200px] w-[250px] shrink-0 rounded-3xl" />)}
          {premium?.slice(0, 6).map((n) => <PremiumCard key={n.id} n={n} onOpen={() => navigate(`/number/${n.id}`)} />)}
          {premium && premium.length === 0 && <div className="card w-full p-5 text-sm text-muted">Скоро здесь появятся красивые номера ✨</div>}
        </motion.div>
      </section>

      {/* Advantages */}
      <section>
        <SectionHeader title="Почему F1Z PRIME" />
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: Zap, t: 'Быстрая выдача', d: 'Сразу после подтверждения оплаты', c: 'text-warning bg-warning/12' },
            { icon: ShieldCheck, t: 'Безопасно', d: 'Оплата через Telegram Stars', c: 'text-success bg-success/12' },
            { icon: Headphones, t: 'Поддержка', d: 'Отвечаем прямо в Telegram', c: 'text-secondary bg-secondary/12' },
            { icon: Undo2, t: 'Возвраты', d: 'Средства вернутся на баланс', c: 'text-primary-soft bg-primary/12' },
          ].map(({ icon: Icon, t, d, c }) => (
            <div key={t} className="card p-4">
              <div className={`grid h-10 w-10 place-items-center rounded-2xl ${c}`}><Icon className="h-5 w-5" /></div>
              <div className="mt-3 text-[14px] font-bold">{t}</div>
              <div className="mt-0.5 text-[12px] leading-snug text-muted">{d}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
