"""Admin: automation rules WHEN → IF → THEN (permission system.automation)."""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import SessionDep
from app.api.deps import perm as P
from app.models import AutomationRule, RuleRun
from app.services import rules
from app.services.common import log_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])


class RuleIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    trigger: str = Field(max_length=32)
    match: Literal["all", "any"] = "all"
    conditions: list[dict[str, Any]] = Field(default_factory=list, max_length=rules.MAX_CONDITIONS)
    actions: list[dict[str, Any]] = Field(min_length=1, max_length=rules.MAX_ACTIONS)
    is_active: bool = False
    priority: int = Field(default=100, ge=0, le=10000)


class RulePatch(RuleIn):
    version: int = Field(ge=1)


class DryRunIn(BaseModel):
    trigger: str = Field(max_length=32)
    match: Literal["all", "any"] = "all"
    conditions: list[dict[str, Any]] = Field(default_factory=list, max_length=rules.MAX_CONDITIONS)
    actions: list[dict[str, Any]] = Field(default_factory=list, max_length=rules.MAX_ACTIONS)
    entity_id: int | None = Field(default=None, gt=0)


def _out(r: AutomationRule) -> dict:
    return {
        "id": r.id, "name": r.name, "trigger": r.trigger, "trigger_label": rules.TRIGGERS.get(r.trigger, r.trigger),
        "match": r.match, "conditions": r.conditions, "actions": r.actions,
        "actions_text": [rules.describe(a) for a in r.actions if a.get("type") in rules.ACTIONS],
        "is_active": r.is_active, "priority": r.priority, "runs": r.runs, "matches": r.matches,
        "failures": r.failures, "last_run_at": r.last_run_at, "version": r.version, "created_by": r.created_by,
        "updated_by": r.updated_by, "created_at": r.created_at,
    }


@router.get("/rules/catalog")
async def rules_catalog(_: P("system.view")) -> dict:
    return rules.catalog()


@router.get("/rules")
async def list_rules(_: P("system.view"), session: SessionDep) -> list[dict]:
    rows = (await session.scalars(select(AutomationRule).order_by(AutomationRule.priority, AutomationRule.id))).all()
    return [_out(r) for r in rows]


@router.post("/rules", status_code=201)
async def create_rule(body: RuleIn, admin: P("system.automation"), session: SessionDep) -> dict:
    conds, acts = rules.validate(body.trigger, body.conditions, body.actions, body.match)
    rule = AutomationRule(name=body.name.strip(), trigger=body.trigger, match=body.match, conditions=conds,
                          actions=acts, is_active=body.is_active, priority=body.priority, created_by=str(admin))
    session.add(rule)
    await session.flush()
    log_admin(session, admin, "create", "rule", rule.id, name=rule.name, trigger=rule.trigger, conditions=conds,
              actions=acts, is_active=rule.is_active)
    await session.commit()
    return _out(rule)


@router.patch("/rules/{rule_id}")
async def update_rule(rule_id: int, body: RulePatch, admin: P("system.automation"), session: SessionDep) -> dict:
    rule = await session.scalar(select(AutomationRule).where(AutomationRule.id == rule_id).with_for_update())
    if rule is None:
        raise HTTPException(404, "Правило не найдено")
    if rule.version != body.version:
        raise HTTPException(409, "Правило уже изменил другой сотрудник — обновите страницу")
    conds, acts = rules.validate(body.trigger, body.conditions, body.actions, body.match)
    before = _out(rule)
    rule.name, rule.trigger, rule.match = body.name.strip(), body.trigger, body.match
    rule.conditions, rule.actions = conds, acts
    rule.is_active, rule.priority = body.is_active, body.priority
    rule.version += 1
    rule.updated_by = str(admin)
    log_admin(session, admin, "update", "rule", rule.id, before={k: before[k] for k in ("name", "trigger", "conditions",
              "actions", "is_active")}, after={"name": rule.name, "conditions": conds, "actions": acts,
                                              "is_active": rule.is_active})
    await session.commit()
    return _out(rule)


class ToggleIn(BaseModel):
    is_active: bool


@router.post("/rules/{rule_id}/toggle")
async def toggle_rule(rule_id: int, body: ToggleIn, admin: P("system.automation"), session: SessionDep) -> dict:
    rule = await session.get(AutomationRule, rule_id)
    if rule is None:
        raise HTTPException(404, "Правило не найдено")
    rule.is_active = body.is_active
    rule.version += 1
    rule.updated_by = str(admin)
    log_admin(session, admin, "enable" if body.is_active else "disable", "rule", rule.id, name=rule.name)
    await session.commit()
    return _out(rule)


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: int, admin: P("system.automation"), session: SessionDep) -> dict:
    rule = await session.get(AutomationRule, rule_id)
    if rule is None:
        raise HTTPException(404, "Правило не найдено")
    log_admin(session, admin, "delete", "rule", rule.id, name=rule.name)
    await session.delete(rule)
    await session.commit()
    return {"deleted": True}


@router.post("/rules/dry-run")
async def dry_run(body: DryRunIn, _: P("system.view"), session: SessionDep) -> dict:
    """Checks a (possibly unsaved) rule against a real order/ticket. Nothing is executed or sent."""
    conds, acts = rules.validate(body.trigger, body.conditions, body.actions or [{"type": "inbox", "params": {"text": "-"}}],
                                 body.match)
    result = await rules.dry_run(session, body.trigger, conds, body.match, acts if body.actions else [], body.entity_id)
    return result


@router.get("/rules/{rule_id}/runs")
async def rule_runs(rule_id: int, _: P("system.view"), session: SessionDep,
                    limit: int = Query(50, ge=1, le=200)) -> list[dict]:
    rows = (
        await session.scalars(select(RuleRun).where(RuleRun.rule_id == rule_id).order_by(RuleRun.id.desc()).limit(limit))
    ).all()
    return [{"id": r.id, "event": r.event, "entity_id": r.entity_id, "matched": r.matched, "dry_run": r.dry_run,
             "result": r.result, "created_at": r.created_at} for r in rows]
