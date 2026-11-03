"""Separate prices per payment currency: USD (reference) and Telegram Stars are stored per product,
never derived from an exchange rate; orders keep the Stars amount fixed at creation time.

Additive only: existing orders, payments and amounts are untouched.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-11 18:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0007'
down_revision: Union[str, None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('products', sa.Column('price_usd', sa.Numeric(12, 2), nullable=True))
    op.add_column('products', sa.Column('price_stars', sa.Integer(), nullable=True))
    op.add_column('products', sa.Column('stars_enabled', sa.Boolean(), nullable=False, server_default='true'))
    op.create_check_constraint('ck_products_price_usd_positive', 'products', 'price_usd IS NULL OR price_usd > 0')
    op.create_check_constraint('ck_products_price_stars_positive', 'products', 'price_stars IS NULL OR price_stars > 0')
    op.add_column('orders', sa.Column('stars_total', sa.Integer(), nullable=True))
    op.add_column('orders', sa.Column('usd_total', sa.Numeric(12, 2), nullable=True))


def downgrade() -> None:
    op.drop_column('orders', 'usd_total')
    op.drop_column('orders', 'stars_total')
    op.drop_constraint('ck_products_price_stars_positive', 'products')
    op.drop_constraint('ck_products_price_usd_positive', 'products')
    op.drop_column('products', 'stars_enabled')
    op.drop_column('products', 'price_stars')
    op.drop_column('products', 'price_usd')
