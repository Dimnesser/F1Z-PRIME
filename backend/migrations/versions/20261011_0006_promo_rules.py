"""Promo codes, product extensions (sale price, tags, attributes, schedule, limits, price history), automation rules

Additive only: new nullable/defaulted columns and new tables.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-11 14:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0006'
down_revision: Union[str, None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NOW = sa.text('now()')
MONEY = sa.Numeric(12, 2)


def upgrade() -> None:
    # --- products
    op.add_column('products', sa.Column('sale_price', MONEY, nullable=True))
    op.add_column('products', sa.Column('sale_ends_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('products', sa.Column('tags', sa.JSON(), nullable=False, server_default='[]'))
    op.add_column('products', sa.Column('attributes', sa.JSON(), nullable=False, server_default='{}'))
    op.add_column('products', sa.Column('available_from', sa.DateTime(timezone=True), nullable=True))
    op.add_column('products', sa.Column('available_until', sa.DateTime(timezone=True), nullable=True))
    op.add_column('products', sa.Column('max_per_order', sa.Integer(), nullable=True))
    op.add_column('products', sa.Column('max_per_user', sa.Integer(), nullable=True))
    op.create_check_constraint('ck_products_sale_price_positive', 'products', 'sale_price IS NULL OR sale_price > 0')
    op.create_table(
        'price_history',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('product_id', sa.Integer(), sa.ForeignKey('products.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('field', sa.String(16), nullable=False),
        sa.Column('old_value', MONEY, nullable=True),
        sa.Column('new_value', MONEY, nullable=True),
        sa.Column('actor', sa.String(64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False),
    )

    # --- promo codes
    op.create_table(
        'promo_codes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(32), nullable=False, unique=True),
        sa.Column('kind', sa.String(8), nullable=False),
        sa.Column('value', MONEY, nullable=False),
        sa.Column('min_total', MONEY, nullable=True),
        sa.Column('max_discount', MONEY, nullable=True),
        sa.Column('starts_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('max_uses', sa.Integer(), nullable=True),
        sa.Column('max_uses_per_user', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('used_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('product_ids', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('categories', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('first_order_only', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('note', sa.String(255), nullable=False, server_default=''),
        sa.Column('created_by', sa.String(64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.CheckConstraint('value > 0', name='ck_promo_value_positive'),
        sa.CheckConstraint('used_count >= 0', name='ck_promo_used_non_negative'),
    )
    op.create_table(
        'promo_redemptions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('promo_id', sa.Integer(), sa.ForeignKey('promo_codes.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('order_id', sa.Integer(), sa.ForeignKey('orders.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('discount', MONEY, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False),
    )
    op.add_column('orders', sa.Column('discount', MONEY, nullable=False, server_default='0'))
    op.add_column('orders', sa.Column('promo_code', sa.String(32), nullable=True))

    # --- automation rules
    op.create_table(
        'automation_rules',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(80), nullable=False),
        sa.Column('trigger', sa.String(32), nullable=False, index=True),
        sa.Column('conditions', sa.JSON(), nullable=False),
        sa.Column('match', sa.String(4), nullable=False, server_default='all'),
        sa.Column('actions', sa.JSON(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('priority', sa.Integer(), nullable=False, server_default='100'),
        sa.Column('runs', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('matches', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('failures', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_run_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_by', sa.String(64), nullable=False),
        sa.Column('updated_by', sa.String(64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False),
    )
    op.create_table(
        'rule_runs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('rule_id', sa.Integer(), sa.ForeignKey('automation_rules.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('event', sa.String(32), nullable=False),
        sa.Column('entity_id', sa.Integer(), nullable=True),
        sa.Column('matched', sa.Boolean(), nullable=False),
        sa.Column('dry_run', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('result', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False, index=True),
    )


def downgrade() -> None:
    op.drop_table('rule_runs')
    op.drop_table('automation_rules')
    op.drop_column('orders', 'promo_code')
    op.drop_column('orders', 'discount')
    op.drop_table('promo_redemptions')
    op.drop_table('promo_codes')
    op.drop_table('price_history')
    op.drop_constraint('ck_products_sale_price_positive', 'products')
    for col in ('max_per_user', 'max_per_order', 'available_until', 'available_from', 'attributes', 'tags',
                'sale_ends_at', 'sale_price'):
        op.drop_column('products', col)
