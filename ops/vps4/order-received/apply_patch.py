#!/usr/bin/env python3
"""«Получил номер — завершить заказ» in the Mini App: buyer confirms receipt, then the review form opens (vps4).

Builds on the reviews patch. Anchored, all-or-nothing, re-runnable. Usage: python3 apply_patch.py /path [--check]
"""
from __future__ import annotations

import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
NEW_FILES = {
    'ReceivedCard.tsx': 'frontend/src/components/ReceivedCard.tsx',
    'test_order_received.py': 'tests/test_order_received.py',
}

REVIEWS_TAIL = '''

RECEIVED_ACTOR = "buyer:received"


async def received(session, order_id: int) -> bool:  # noqa: ANN001
    """The buyer pressed «Получил номер — завершить заказ» (recorded once in the order history)."""
    from app.models import OrderEvent

    return await session.scalar(select(OrderEvent.id).where(
        OrderEvent.order_id == order_id, OrderEvent.actor == RECEIVED_ACTOR).limit(1)) is not None


async def mark_received(session, order: Order) -> None:  # noqa: ANN001
    from app.services.orders import add_event

    if not eligible(order):
        raise ServiceError("Заказ ещё не выдан. Дождитесь номера и войдите в аккаунт.", 409, "order_not_delivered")
    if not await received(session, order.id):
        add_event(session, order, order.status, RECEIVED_ACTOR, note="Покупатель подтвердил получение и вход")
'''

ROUTE = '''@router.post("/orders/{order_id}/received")
async def order_received(order_id: int, user: UserDep, session: SessionDep) -> dict:
    """Buyer confirms the number works; afterwards the review form is shown."""
    from app.services import reviews

    order = await lock(session, Order, order_id)
    if order is None or order.user_id != user.id:
        raise HTTPException(404, "Заказ не найден")
    await reviews.mark_received(session, order)
    await session.commit()
    return {"received": True}


@router.post("/orders/{order_id}/review")'''

EDITS: dict[str, list[tuple[str, str]]] = {
    'backend/app/api/public.py': [
        ('@router.post("/orders/{order_id}/review")', ROUTE),
        ('    data.review_allowed = reviews.eligible(order)\n',
         '    data.review_allowed = reviews.eligible(order)\n'
         '    data.received = await reviews.received(session, order.id)\n'),
    ],
    'backend/app/schemas.py': [
        ('    review_allowed: bool = False\n', '    review_allowed: bool = False\n    received: bool = False\n'),
    ],
    'frontend/src/lib/types.ts': [
        ('  review_allowed: boolean\n', '  review_allowed: boolean\n  received: boolean\n'),
    ],
    'frontend/src/lib/api.ts': [
        ('  review: (orderId: number, rating: number, text: string) =>\n',
         '  received: (orderId: number) => post<{ received: boolean }>(`/api/orders/${orderId}/received`),\n'
         '  review: (orderId: number, rating: number, text: string) =>\n'),
    ],
    'frontend/src/pages/OrderDetail.tsx': [
        ("import ReviewCard from '../components/ReviewCard'\n",
         "import ReceivedCard from '../components/ReceivedCard'\nimport ReviewCard from '../components/ReviewCard'\n"),
        ('      {(o.review_allowed || o.review) && <ReviewCard key={`${o.id}:${o.review?.updated_at ?? ""}`} order={o} />}',
         '      {o.review_allowed && !o.received && !o.review && <ReceivedCard orderId={o.id} />}\n'
         '      {((o.review_allowed && o.received) || o.review) && <ReviewCard key={`${o.id}:${o.review?.updated_at ?? ""}`} order={o} />}'),
    ],
}


def main() -> int:
    root = pathlib.Path(sys.argv[1]).resolve()
    check_only = '--check' in sys.argv[2:]
    if (root / NEW_FILES['ReceivedCard.tsx']).exists():
        print('ALREADY_PATCHED')
        return 0
    reviews = root / 'backend/app/services/reviews.py'
    text = reviews.read_text(encoding='utf-8')
    if 'def eligible(order: Order)' not in text or 'ServiceError' not in text or 'RECEIVED_ACTOR' in text:
        print('REVIEWS_BASE_MISMATCH')
        return 1
    patched = {'backend/app/services/reviews.py': text.rstrip('\n') + '\n' + REVIEWS_TAIL}
    for rel, edits in EDITS.items():
        text = (root / rel).read_text(encoding='utf-8')
        for old, new in edits:
            count = text.count(old)
            if count != 1:
                print(f'ANCHOR_MISMATCH {rel}: found {count}x: {old[:80]!r}')
                return 1
            text = text.replace(old, new, 1)
        patched[rel] = text
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
