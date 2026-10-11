"""Phone-number inventory: per-country stock of real numbers, auto-detected country, atomic allocation.

Additive only. Introduces `phone_inventory` and a `products.uses_phone_inventory` flag; a verification
scaffold (`phone_verifications`) is added for a future, authorised number-ownership confirmation flow
(mock provider only — no Telegram auth codes or sessions are ever read here).

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-12 09:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0008'
down_revision: Union[str, None] = '0007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('products', sa.Column('uses_phone_inventory', sa.Boolean(), nullable=False, server_default='false'))

    op.create_table(
        'phone_inventory',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('phone_e164', sa.String(24), nullable=False),
        sa.Column('country_iso2', sa.String(2), nullable=False),
        sa.Column('country_name', sa.String(64), nullable=False, server_default=''),
        sa.Column('product_id', sa.Integer(), sa.ForeignKey('products.id', ondelete='SET NULL'), nullable=True),
        # AVAILABLE | RESERVED | SOLD | DISABLED
        sa.Column('status', sa.String(10), nullable=False, server_default='AVAILABLE'),
        sa.Column('reserved_order_id', sa.Integer(), sa.ForeignKey('orders.id', ondelete='SET NULL'), nullable=True),
        sa.Column('sold_order_id', sa.Integer(), sa.ForeignKey('orders.id', ondelete='SET NULL'), nullable=True),
        sa.Column('batch', sa.String(64), nullable=True),
        sa.Column('added_by', sa.String(64), nullable=False, server_default=''),
        sa.Column('note', sa.String(255), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('reserved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('sold_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('phone_e164', name='uq_phone_inventory_e164'),
    )
    op.create_index('ix_phone_inventory_product_status', 'phone_inventory', ['product_id', 'status'])
    op.create_index('ix_phone_inventory_country_status', 'phone_inventory', ['country_iso2', 'status'])
    op.create_index('ix_phone_inventory_reserved_order', 'phone_inventory', ['reserved_order_id'])
    op.create_index('ix_phone_inventory_sold_order', 'phone_inventory', ['sold_order_id'])

    # Verification scaffold (future authorised ownership-confirmation; mock provider only for now).
    op.create_table(
        'phone_verifications',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('order_id', sa.Integer(), sa.ForeignKey('orders.id', ondelete='CASCADE'), nullable=False),
        sa.Column('phone_id', sa.Integer(), sa.ForeignKey('phone_inventory.id', ondelete='SET NULL'), nullable=True),
        sa.Column('provider', sa.String(32), nullable=False, server_default='mock'),
        # WAITING | RECEIVED | APPROVED | EXPIRED | FAILED
        sa.Column('status', sa.String(10), nullable=False, server_default='WAITING'),
        sa.Column('code_masked', sa.String(32), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('events', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('decided_by', sa.String(64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), onupdate=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_phone_verifications_order', 'phone_verifications', ['order_id'])
    op.create_index('ix_phone_verifications_status', 'phone_verifications', ['status'])


def downgrade() -> None:
    op.drop_table('phone_verifications')
    op.drop_index('ix_phone_inventory_sold_order', table_name='phone_inventory')
    op.drop_index('ix_phone_inventory_reserved_order', table_name='phone_inventory')
    op.drop_index('ix_phone_inventory_country_status', table_name='phone_inventory')
    op.drop_index('ix_phone_inventory_product_status', table_name='phone_inventory')
    op.drop_table('phone_inventory')
    op.drop_column('products', 'uses_phone_inventory')
