"""Automation rules: WHEN <event> IF <conditions> THEN <actions>.

Safety by construction:
- rules are declarative JSON checked against whitelists (fields, operators, actions) when saved; nothing is ever
  evaluated as code (no eval/exec/format on user input; message text uses the escaped template renderer);
- actions never emit events, so a rule can't trigger another rule (no loops); one evaluation per (event, entity),
  at most MAX_ACTIONS actions per rule;
- actions are notifications, notes, ticket routing and holding an order for review. Money movements and delivery
  are not rule actions: payments, refunds and fulfillment keep all their server-side checks whatever rules say.
"""
from __future__ import annotations

import html
import logging
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AdminUser, AutomationRule, Order, RuleRun, SupportTicket
from app.services import jobs
from app.services.common import ServiceError, utcnow

log = logging.getLogger("f1z.rules")

MAX_CONDITIONS = 10
MAX_ACTIONS = 5
MAX_RULES_PER_EVENT = 50

ORDER_EVENTS = ("order_created", "order_paid", "order_delivered", "fulfillment_failed", "order_cancelled", "payment_review")
TRIGGERS: dict[str, str] = {
    "order_created": "Создан заказ",
    "order_paid": "Заказ оплачен",
    "order_delivered": "Товар выдан",
    "fulfillment_failed": "Ошибка автовыдачи",
    "order_cancelled": "Заказ отменён / истёк",
    "payment_review": "Платёж отправлен на проверку",
    "ticket_created": "Новое обращение в поддержку",
}

# field: (label, type, events where it exists)
NUM, STR, LIST, BOOL = "number", "string", "list", "bool"
FIELDS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "order.total": ("Сумма заказа, грн", NUM, ORDER_EVENTS),
    "order.quantity": ("Количество", NUM, ORDER_EVENTS),
    "order.discount": ("Скидка, грн", NUM, ORDER_EVENTS),
    "order.promo_code": ("Промокод", STR, ORDER_EVENTS),
    "order.payment_method": ("Способ оплаты", STR, ORDER_EVENTS),
    "product.id": ("ID товара", NUM, ORDER_EVENTS),
    "product.category": ("Категория товара", STR, ORDER_EVENTS),
    "product.tags": ("Теги товара", LIST, ORDER_EVENTS),
    "product.fulfillment_mode": ("Режим выдачи", STR, ORDER_EVENTS),
    "user.orders_count": ("Оплаченных заказов у покупателя", NUM, ORDER_EVENTS + ("ticket_created",)),
    "user.total_spent": ("Потратил всего, грн", NUM, ORDER_EVENTS + ("ticket_created",)),
    "user.is_new": ("Новый покупатель (первый заказ)", BOOL, ORDER_EVENTS + ("ticket_created",)),
    "ticket.category": ("Категория обращения", STR, ("ticket_created",)),
    "ticket.priority": ("Приоритет обращения", STR, ("ticket_created",)),
    "ticket.has_order": ("Обращение по заказу", BOOL, ("ticket_created",)),
    "time.hour": ("Час (Киев, 0–23)", NUM, tuple(TRIGGERS)),
    "time.weekday": ("День недели (1 = пн … 7 = вс)", NUM, tuple(TRIGGERS)),
}

OPS: dict[str, tuple[str, tuple[str, ...]]] = {
    "eq": ("равно", (NUM, STR, BOOL)),
    "ne": ("не равно", (NUM, STR, BOOL)),
    "gt": ("больше", (NUM,)),
    "gte": ("не меньше", (NUM,)),
    "lt": ("меньше", (NUM,)),
    "lte": ("не больше", (NUM,)),
    "in": ("одно из", (NUM, STR)),
    "not_in": ("ни одно из", (NUM, STR)),
    "contains": ("содержит", (LIST, STR)),
}

# action: (label, events, params schema {name: (type, required)})
ACTIONS: dict[str, tuple[str, tuple[str, ...], dict[str, tuple[str, bool]]]] = {
    "notify_staff": ("Сообщение сотрудникам в Telegram", tuple(TRIGGERS), {"text": (STR, True), "permission": (STR, False)}),
    "inbox": ("Уведомление в центре уведомлений панели", tuple(TRIGGERS), {"text": (STR, True), "permission": (STR, False)}),
    "notify_customer": ("Сообщение покупателю (шаблон)", ORDER_EVENTS, {"template": (STR, True)}),
    "order_note": ("Заметка в истории заказа", ORDER_EVENTS, {"text": (STR, True)}),
    "hold_for_review": ("Задержать автовыдачу до проверки оператором", ("order_paid",), {}),
    "ticket_priority": ("Изменить приоритет обращения", ("ticket_created",), {"priority": (STR, True)}),
    "ticket_assign": ("Назначить обращение сотруднику", ("ticket_created",), {"username": (STR, True)}),
}


# ------------------------------------------------------------------ validation


def _coerce(ftype: str, op: str, value: Any) -> Any:
    def one(v: Any) -> Any:
        if ftype == NUM:
            try:
                return str(Decimal(str(v)))
            except (InvalidOperation, ValueError):
                raise ServiceError(f"Значение «{v}» должно быть числом", 422) from None
        if ftype == BOOL:
            if isinstance(v, bool):
                return v
            if str(v).lower() in ("true", "1", "да"):
                return True
            if str(v).lower() in ("false", "0", "нет"):
                return False
            raise ServiceError("Значение должно быть да/нет", 422)
        s = str(v).strip()
        if not s or len(s) > 64:
            raise ServiceError("Текстовое значение: от 1 до 64 символов", 422)
        return s

    if op in ("in", "not_in"):
        items = value if isinstance(value, list) else [x for x in str(value).split(",")]
        items = [x for x in items if str(x).strip()]
        if not 1 <= len(items) <= 50:
            raise ServiceError("Список значений: от 1 до 50 элементов", 422)
        return [one(x) for x in items]
    return one(value)


def validate(trigger: str, conditions: list[dict], actions: list[dict], match: str = "all") -> tuple[list[dict], list[dict]]:
    """Returns normalised (conditions, actions) or raises ServiceError with a human message."""
    from app.services import notifications, rbac
    from app.services import support as support_service

    if trigger not in TRIGGERS:
        raise ServiceError("Неизвестное событие", 422)
    if match not in ("all", "any"):
        raise ServiceError("Совпадение: all или any", 422)
    if len(conditions) > MAX_CONDITIONS:
        raise ServiceError(f"Не более {MAX_CONDITIONS} условий", 422)
    if not 1 <= len(actions) <= MAX_ACTIONS:
        raise ServiceError(f"Нужно от 1 до {MAX_ACTIONS} действий", 422)
    conds = []
    for c in conditions:
        field, op = str(c.get("field", "")), str(c.get("op", ""))
        if field not in FIELDS or trigger not in FIELDS[field][2]:
            raise ServiceError(f"Поле «{field}» недоступно для этого события", 422)
        ftype = FIELDS[field][1]
        if op not in OPS or ftype not in OPS[op][1]:
            raise ServiceError(f"Оператор «{op}» не подходит для поля «{FIELDS[field][0]}»", 422)
        value_type = STR if ftype == LIST else ftype
        conds.append({"field": field, "op": op, "value": _coerce(value_type, op, c.get("value"))})
    acts = []
    for a in actions:
        kind = str(a.get("type", ""))
        if kind not in ACTIONS or trigger not in ACTIONS[kind][1]:
            raise ServiceError(f"Действие «{kind}» недоступно для этого события", 422)
        params = a.get("params") or {}
        clean: dict[str, Any] = {}
        for name, (_, required) in ACTIONS[kind][2].items():
            v = params.get(name)
            if v in (None, ""):
                if required:
                    raise ServiceError(f"Действие «{ACTIONS[kind][0]}»: заполните поле {name}", 422)
                continue
            v = str(v).strip()
            if name == "text" and len(v) > 1000:
                raise ServiceError("Текст сообщения — до 1000 символов", 422)
            if name == "permission" and v not in rbac.PERMISSIONS:
                raise ServiceError("Неизвестное право доступа для получателей", 422)
            if name == "template" and (v not in notifications.TEMPLATES or notifications.TEMPLATES[v][0] != "customer"):
                raise ServiceError("Неизвестный шаблон уведомления покупателю", 422)
            if name == "priority" and v not in support_service.PRIORITIES:
                raise ServiceError("Приоритет: low, normal, high, urgent", 422)
            clean[name] = v
        acts.append({"type": kind, "params": clean})
    return conds, acts


# ------------------------------------------------------------------ context & evaluation


def _time_values(now: datetime | None = None) -> dict[str, Any]:
    local = (now or utcnow()).astimezone(ZoneInfo("Europe/Kyiv"))
    return {"time.hour": Decimal(local.hour), "time.weekday": Decimal(local.isoweekday())}


def _user_values(user) -> dict[str, Any]:  # noqa: ANN001
    return {"user.orders_count": Decimal(user.orders_count), "user.total_spent": Decimal(str(user.total_spent)),
            "user.is_new": user.orders_count <= 1}


async def context(session: AsyncSession, event: str, entity_id: int) -> tuple[dict[str, Any], Any]:
    """Flat field values for an event + the entity (Order or SupportTicket)."""
    values = _time_values()
    if event == "ticket_created":
        ticket = await session.get(SupportTicket, entity_id)
        if ticket is None:
            raise ServiceError("Обращение не найдено", 404)
        values.update(_user_values(ticket.user))
        values.update({"ticket.category": ticket.category, "ticket.priority": ticket.priority,
                       "ticket.has_order": ticket.order_id is not None})
        return values, ticket
    order = await session.get(Order, entity_id)
    if order is None:
        raise ServiceError("Заказ не найден", 404)
    p = order.product
    values.update(_user_values(order.user))
    values.update({
        "order.total": Decimal(str(order.total)), "order.quantity": Decimal(order.quantity),
        "order.discount": Decimal(str(order.discount or 0)), "order.promo_code": order.promo_code or "",
        "order.payment_method": order.payment_method or "",
        "product.id": Decimal(p.id) if p else Decimal(0), "product.category": p.category if p else "premium",
        "product.tags": list(p.tags or []) if p else [], "product.fulfillment_mode": p.fulfillment_mode if p else "",
    })
    return values, order


def _check(cond: dict, values: dict[str, Any]) -> bool:
    field, op, expected = cond["field"], cond["op"], cond["value"]
    actual = values.get(field)
    ftype = FIELDS[field][1]
    if actual is None:
        return False
    if ftype == NUM:
        a = Decimal(str(actual))
        if op in ("in", "not_in"):
            hit = any(a == Decimal(x) for x in expected)
            return hit if op == "in" else not hit
        e = Decimal(str(expected))
        return {"eq": a == e, "ne": a != e, "gt": a > e, "gte": a >= e, "lt": a < e, "lte": a <= e}[op]
    if ftype == BOOL:
        return (actual == expected) if op == "eq" else (actual != expected)
    if ftype == LIST:
        return str(expected).lower() in [str(x).lower() for x in actual]
    a = str(actual).lower()
    if op == "eq":
        return a == str(expected).lower()
    if op == "ne":
        return a != str(expected).lower()
    if op == "in":
        return a in [str(x).lower() for x in expected]
    if op == "not_in":
        return a not in [str(x).lower() for x in expected]
    return str(expected).lower() in a  # contains


def evaluate(rule_conditions: list[dict], match: str, values: dict[str, Any]) -> tuple[bool, list[dict]]:
    details = [{"field": c["field"], "op": c["op"], "value": c["value"],
                "actual": _plain(values.get(c["field"])), "ok": _check(c, values)} for c in rule_conditions]
    if not details:
        return True, details
    ok = all(d["ok"] for d in details) if match == "all" else any(d["ok"] for d in details)
    return ok, details


def _plain(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    return v


def describe(action: dict) -> str:
    label = ACTIONS[action["type"]][0]
    p = action.get("params") or {}
    extra = p.get("text") or p.get("template") or p.get("priority") or p.get("username") or ""
    return f"{label}: {extra[:120]}" if extra else label


# ------------------------------------------------------------------ firing (async, in the worker)


async def fire(session: AsyncSession, event: str, entity_id: int) -> None:
    """Queue rule evaluation for an event (only if an active rule listens to it). Same transaction as the event."""
    has_rule = await session.scalar(
        select(AutomationRule.id).where(AutomationRule.trigger == event, AutomationRule.is_active.is_(True)).limit(1)
    )
    if has_rule:
        await jobs.enqueue(session, "rules", {"event": event, "entity_id": entity_id},
                           dedupe_key=f"rules:{event}:{entity_id}", max_attempts=3)


async def run_event(session: AsyncSession, event: str, entity_id: int) -> int:
    """Evaluate all active rules for an event; returns the number of matched rules. Called by the worker."""
    rules = (
        await session.scalars(
            select(AutomationRule).where(AutomationRule.trigger == event, AutomationRule.is_active.is_(True))
            .order_by(AutomationRule.priority, AutomationRule.id).limit(MAX_RULES_PER_EVENT)
        )
    ).all()
    if not rules:
        return 0
    values, entity = await context(session, event, entity_id)
    matched = 0
    for rule in rules:
        ok, details = evaluate(rule.conditions, rule.match, values)
        results: list[dict] = []
        failed = False
        if ok:
            matched += 1
            for action in rule.actions[:MAX_ACTIONS]:
                try:
                    async with session.begin_nested():
                        done = await _execute(session, action, event, entity, rule)
                    results.append({"action": action["type"], "ok": True, "result": done})
                except Exception as exc:  # noqa: BLE001 - one bad action must not stop the others
                    failed = True
                    results.append({"action": action["type"], "ok": False, "error": str(exc)[:300]})
                    log.warning("rule %s action %s failed: %s", rule.id, action["type"], exc)
        session.add(RuleRun(rule_id=rule.id, event=event, entity_id=entity_id, matched=ok, dry_run=False,
                            result={"conditions": details, "actions": results}))
        await session.execute(
            update(AutomationRule).where(AutomationRule.id == rule.id).values(
                runs=AutomationRule.runs + 1, matches=AutomationRule.matches + (1 if ok else 0),
                failures=AutomationRule.failures + (1 if failed else 0), last_run_at=utcnow(),
            )
        )
    return matched


async def _execute(session: AsyncSession, action: dict, event: str, entity: Any, rule: AutomationRule) -> str:
    from app.services import inbox, notifications
    from app.services.orders import add_event

    kind, p = action["type"], action.get("params") or {}
    values: dict[str, Any] = {}
    if isinstance(entity, Order):
        values = notifications.order_values(entity)
    elif isinstance(entity, SupportTicket):
        values = {"ticket_id": f"#{entity.id}", "reason": entity.subject}
    if kind == "notify_staff":
        # the rule text and name are escaped first; variables are escaped by render()
        text = f"🤖 <b>{html.escape(rule.name, quote=False)}</b>\n" + notifications.render(
            html.escape(p["text"], quote=False), values)
        n = 0
        for chat_id in await notifications.recipients_with_permission(session, p.get("permission") or "orders.view"):
            await jobs.enqueue(session, "tg_message", {"chat_id": chat_id, "text": text, "reply_markup": None},
                               dedupe_key=f"rule:{rule.id}:{event}:{entity.id}:{chat_id}")
            n += 1
        return f"сообщений: {n}"
    if kind == "inbox":
        text = notifications.render(p["text"], values)
        n = await inbox.notify_permission(session, p.get("permission") or "orders.view", "rule", f"Правило «{rule.name}»", text)
        return f"получателей: {n}"
    if kind == "notify_customer":
        sent = await notifications.notify_customer(session, entity, p["template"], dedupe=f"rule{rule.id}:{p['template']}")
        return "в очереди" if sent else "шаблон выключен"
    if kind == "order_note":
        add_event(session, entity, entity.status, f"rule:{rule.id}", entity.status,
                  note=notifications.render(p["text"], values)[:500])
        return "заметка добавлена"
    if kind == "hold_for_review":
        # evaluated before delivery by fulfillment.process (should_hold); here only a record for history
        return "проверяется при выдаче"
    if kind == "ticket_priority":
        entity.priority = p["priority"]
        return p["priority"]
    if kind == "ticket_assign":
        acc = await session.scalar(select(AdminUser).where(AdminUser.username == p["username"], AdminUser.is_active.is_(True)))
        if acc is None:
            raise ServiceError(f"Сотрудник {p['username']} не найден или отключён")
        entity.assigned_to = acc.username
        await inbox.push(session, f"acc:{acc.id}", "ticket_assigned", f"Вам назначено обращение #{entity.id}", entity.subject)
        return acc.username
    raise ServiceError("Неизвестное действие")


async def should_hold(session: AsyncSession, order: Order) -> str | None:
    """Synchronous check used by fulfillment before automatic delivery. Returns the rule name that holds the order."""
    rules = (
        await session.scalars(
            select(AutomationRule).where(AutomationRule.trigger == "order_paid", AutomationRule.is_active.is_(True))
            .order_by(AutomationRule.priority, AutomationRule.id)
        )
    ).all()
    rules = [r for r in rules if any(a.get("type") == "hold_for_review" for a in r.actions)]
    if not rules:
        return None
    values, _ = await context(session, "order_paid", order.id)
    for rule in rules:
        ok, _ = evaluate(rule.conditions, rule.match, values)
        if ok:
            return rule.name
    return None


async def dry_run(session: AsyncSession, trigger: str, conditions: list[dict], match: str, actions: list[dict],
                  entity_id: int | None) -> dict:
    """Evaluate against a real order/ticket without executing anything."""
    if entity_id is None:
        model = SupportTicket if trigger == "ticket_created" else Order
        stmt = select(model.id).order_by(model.id.desc()).limit(1)
        if model is Order and trigger in ("order_paid", "order_delivered"):
            stmt = select(Order.id).where(Order.paid_at.is_not(None)).order_by(Order.id.desc()).limit(1)
        entity_id = await session.scalar(stmt)
        if entity_id is None:
            raise ServiceError("Нет данных для проверки — укажите номер заказа или обращения", 404)
    values, _ = await context(session, trigger, entity_id)
    ok, details = evaluate(conditions, match, values)
    return {"entity_id": entity_id, "matched": ok, "conditions": details,
            "would_run": [describe(a) for a in actions] if ok else []}


def catalog() -> dict:
    return {
        "triggers": [{"key": k, "label": v} for k, v in TRIGGERS.items()],
        "fields": [{"key": k, "label": v[0], "type": v[1], "events": list(v[2])} for k, v in FIELDS.items()],
        "operators": [{"key": k, "label": v[0], "types": list(v[1])} for k, v in OPS.items()],
        "actions": [{"key": k, "label": v[0], "events": list(v[1]),
                     "params": [{"name": n, "type": t, "required": r} for n, (t, r) in v[2].items()]}
                    for k, v in ACTIONS.items()],
    }

