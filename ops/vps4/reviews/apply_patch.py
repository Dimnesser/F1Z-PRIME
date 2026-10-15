#!/usr/bin/env python3
"""Order reviews for vps4 (/opt/f1z-prime). Anchored, all-or-nothing, re-runnable.

Usage: python3 apply_patch.py /path/to/project-copy [--check]
"""
from __future__ import annotations

import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
NEW_FILES = {
    'reviews.py': 'backend/app/services/reviews.py',
    '20261015_0018_order_reviews.py': 'backend/migrations/versions/20261015_0018_order_reviews.py',
    'ReviewCard.tsx': 'frontend/src/components/ReviewCard.tsx',
    'test_order_reviews.py': 'tests/test_order_reviews.py',
}

MODEL = '''

class OrderReview(Base):
    """Buyer's review of a received order: rating 1-5 and an optional comment, one per order."""

    __tablename__ = "order_reviews"
    __table_args__ = (
        UniqueConstraint("order_id", name="uq_order_reviews_order"),
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_order_reviews_rating"),
        Index("ix_order_reviews_product", "product_id"),
        Index("ix_order_reviews_created", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"))
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, default="", server_default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
'''

ROUTE = '''class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    text: str = Field(default="", max_length=1000)


@router.post("/orders/{order_id}/review")
async def order_review(order_id: int, body: ReviewIn, user: UserDep, session: SessionDep) -> dict:
    """Rating + optional comment from the buyer of a received order; repeated calls edit it."""
    from app.services import reviews

    order = await lock(session, Order, order_id)
    if order is None or order.user_id != user.id:
        raise HTTPException(404, "Заказ не найден")
    result = await reviews.submit(session, order, body.rating, body.text)
    await session.commit()
    return result


@router.post("/orders/{order_id}/pay", response_model=PayResponse)'''

ADMIN_REVIEW = '''            {data.review && (
              <div className="rounded-xl border border-line p-3 text-sm">
                <div className="font-semibold">Отзыв покупателя: <span className="text-amber-400">{'★'.repeat(data.review.rating)}{'☆'.repeat(5 - data.review.rating)}</span> {data.review.rating}/5</div>
                {data.review.text && <p className="mt-1 whitespace-pre-wrap break-words text-muted">{data.review.text}</p>}
              </div>
            )}
            {data.product && ('''

EDITS: dict[str, list[tuple[str, str]]] = {
    'backend/app/api/public.py': [
        ('@router.post("/orders/{order_id}/pay", response_model=PayResponse)', ROUTE),
        ('    return data\n',
         '    from app.services import reviews\n\n'
         '    data.review = await reviews.for_order(session, order.id)\n'
         '    data.review_allowed = reviews.eligible(order)\n'
         '    return data\n'),
    ],
    'backend/app/schemas.py': [
        ('    login_handoffs: list[dict[str, int | str | None]] = []\n',
         '    login_handoffs: list[dict[str, int | str | None]] = []\n'
         '    # buyer review of a received order: {rating, text, created_at, updated_at}\n'
         '    review: dict[str, int | str] | None = None\n'
         '    review_allowed: bool = False\n'),
    ],
    'backend/app/api/admin.py': [
        ('    fulfill_job = next((j for j in job_rows if j.kind == "fulfill"), None)\n',
         '    from app.services import reviews as review_service\n\n'
         '    fulfill_job = next((j for j in job_rows if j.kind == "fulfill"), None)\n'),
        ('        "units": [{"id": u.id, "label": u.label, "status": u.status} for u in units],\n',
         '        "units": [{"id": u.id, "label": u.label, "status": u.status} for u in units],\n'
         '        "review": await review_service.for_order(session, order.id),\n'),
    ],
    'frontend/src/lib/api.ts': [
        ('  cancel: (orderId: number) => post<Order>(`/api/orders/${orderId}/cancel`),\n',
         '  cancel: (orderId: number) => post<Order>(`/api/orders/${orderId}/cancel`),\n'
         '  review: (orderId: number, rating: number, text: string) =>\n'
         '    post<{ rating: number; text: string }>(`/api/orders/${orderId}/review`, { rating, text }),\n'),
    ],
    'frontend/src/lib/types.ts': [
        ('  delivered_phones: { id: number; phone: string }[]\n',
         '  delivered_phones: { id: number; phone: string }[]\n'
         '  review: { rating: number; text: string; created_at: string; updated_at: string } | null\n'
         '  review_allowed: boolean\n'),
    ],
    'frontend/src/pages/OrderDetail.tsx': [
        ("import LoginCodeCard from '../components/LoginCodeCard'\n",
         "import LoginCodeCard from '../components/LoginCodeCard'\nimport ReviewCard from '../components/ReviewCard'\n"),
        ('      <section className="card hairline overflow-hidden" aria-label="Детали заказа">',
         '      {(o.review_allowed || o.review) && <ReviewCard key={`${o.id}:${o.review?.updated_at ?? ""}`} order={o} />}\n\n'
         '      <section className="card hairline overflow-hidden" aria-label="Детали заказа">'),
    ],
    'admin/src/components/orders/shared.tsx': [
        ('  units: { id: number; label: string; status: string }[]\n',
         '  units: { id: number; label: string; status: string }[]\n'
         '  review?: { rating: number; text: string; created_at: string; updated_at: string } | null\n'),
    ],
    'admin/src/components/orders/OrderCard.tsx': [
        ('            {data.product && (', ADMIN_REVIEW),
    ],
}


def main() -> int:
    root = pathlib.Path(sys.argv[1]).resolve()
    check_only = '--check' in sys.argv[2:]
    if (root / NEW_FILES['reviews.py']).exists():
        print('ALREADY_PATCHED')
        return 0
    patched: dict[str, str] = {}
    for rel, edits in EDITS.items():
        text = (root / rel).read_text(encoding='utf-8')
        for old, new in edits:
            count = text.count(old)
            if count != 1:
                print(f'ANCHOR_MISMATCH {rel}: found {count}x: {old[:80]!r}')
                return 1
            text = text.replace(old, new, 1)
        patched[rel] = text
    models = (root / 'backend/app/models.py').read_text(encoding='utf-8')
    if 'class OrderReview' in models:
        print('MODEL_EXISTS')
        return 1
    patched['backend/app/models.py'] = models.rstrip('\n') + '\n' + MODEL
    if (root / 'backend/migrations/versions').exists() and any(
            p.name.split('_')[2:3] == ['0018'] for p in (root / 'backend/migrations/versions').glob('*.py')):
        print('MIGRATION_0018_EXISTS')
        return 1
    if check_only:
        print('ANCHORS_OK')
        return 0
    for rel, text in patched.items():
        (root / rel).write_text(text, encoding='utf-8')
    for src, dst in NEW_FILES.items():
        shutil.copyfile(HERE / src, root / dst)
    print('PATCH_APPLIED', ' '.join(patched), ' '.join(NEW_FILES.values()))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
