"""order automation: fulfillment, encrypted inventory, stock history, durable jobs, incidents, refunds, templates

Additive only: existing rows keep their data; new columns have safe defaults.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-11 10:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0004'
down_revision: Union[str, None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NOW = sa.text('now()')


def upgrade() -> None:
    op.add_column('products', sa.Column('fulfillment_mode', sa.String(16), server_default='manual', nullable=False))
    op.add_column('products', sa.Column('uses_inventory', sa.Boolean(), server_default='false', nullable=False))

    op.add_column('orders', sa.Column('public_id', sa.String(20), nullable=True))
    op.add_column('orders', sa.Column('currency', sa.String(8), server_default='UAH', nullable=False))
    op.add_column('orders', sa.Column('fulfillment_status', sa.String(16), nullable=True))
    op.add_column('orders', sa.Column('fulfillment_attempts', sa.Integer(), server_default='0', nullable=False))
    op.add_column('orders', sa.Column('fulfillment_error', sa.String(500), nullable=True))
    op.add_column('orders', sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint('uq_orders_public_id', 'orders', ['public_id'])
    op.create_index('ix_orders_fulfillment_status', 'orders', ['fulfillment_status'])
    # existing orders: give them a public number and a fulfillment state matching their lifecycle
    op.execute("UPDATE orders SET public_id = 'F1Z-' || lpad(id::text, 6, '0') WHERE public_id IS NULL")
    op.execute("UPDATE orders SET fulfillment_status = 'delivered', delivered_at = completed_at WHERE status = 'completed'")
    op.execute("UPDATE orders SET fulfillment_status = 'manual' WHERE status IN ('paid', 'processing')")

    op.add_column('support_tickets', sa.Column('order_id', sa.Integer(), nullable=True))
    op.add_column('support_tickets', sa.Column('category', sa.String(32), server_default='general', nullable=False))
    op.add_column('support_tickets', sa.Column('priority', sa.String(16), server_default='normal', nullable=False))
    op.create_foreign_key('fk_support_tickets_order', 'support_tickets', 'orders', ['order_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_support_tickets_order_id', 'support_tickets', ['order_id'])

    op.create_table(
        'inventory_items',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('product_id', sa.Integer(), sa.ForeignKey('products.id', ondelete='CASCADE'), nullable=False),
        sa.Column('secret_enc', sa.Text(), nullable=False),
        sa.Column('fingerprint', sa.String(64), nullable=False),
        sa.Column('label', sa.String(64), nullable=False, server_default=''),
        sa.Column('status', sa.String(16), server_default='available', nullable=False),
        sa.Column('order_id', sa.Integer(), sa.ForeignKey('orders.id', ondelete='SET NULL'), nullable=True),
        sa.Column('batch', sa.String(64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column('reserved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('sold_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('product_id', 'fingerprint', name='uq_inventory_product_fingerprint'),
    )
    op.create_index('ix_inventory_product_status', 'inventory_items', ['product_id', 'status'])
    op.create_index('ix_inventory_items_order_id', 'inventory_items', ['order_id'])

    op.create_table(
        'stock_movements',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('product_id', sa.Integer(), sa.ForeignKey('products.id', ondelete='CASCADE'), nullable=False),
        sa.Column('delta', sa.Integer(), nullable=False),
        sa.Column('stock_after', sa.Integer(), nullable=False),
        sa.Column('reason', sa.String(32), nullable=False),
        sa.Column('note', sa.String(255), nullable=False, server_default=''),
        sa.Column('actor', sa.String(64), nullable=False, server_default='system'),
        sa.Column('order_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False),
    )
    op.create_index('ix_stock_movements_product_id', 'stock_movements', ['product_id'])
    op.create_index('ix_stock_movements_created_at', 'stock_movements', ['created_at'])

    op.create_table(
        'jobs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('kind', sa.String(32), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(12), server_default='pending', nullable=False),
        sa.Column('attempts', sa.Integer(), server_default='0', nullable=False),
        sa.Column('max_attempts', sa.Integer(), server_default='6', nullable=False),
        sa.Column('run_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column('locked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.String(500), nullable=True),
        sa.Column('dedupe_key', sa.String(128), nullable=True, unique=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_jobs_status_run_at', 'jobs', ['status', 'run_at'])

    op.create_table(
        'task_runs',
        sa.Column('name', sa.String(48), primary_key=True),
        sa.Column('last_started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_success_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.String(500), nullable=True),
        sa.Column('last_duration_ms', sa.Integer(), nullable=True),
        sa.Column('runs', sa.Integer(), server_default='0', nullable=False),
        sa.Column('failures', sa.Integer(), server_default='0', nullable=False),
    )

    op.create_table(
        'incidents',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('kind', sa.String(32), nullable=False),
        sa.Column('severity', sa.String(12), nullable=False),
        sa.Column('status', sa.String(12), server_default='open', nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('details', sa.JSON(), nullable=False),
        sa.Column('order_id', sa.Integer(), nullable=True),
        sa.Column('payment_id', sa.Integer(), nullable=True),
        sa.Column('dedupe_key', sa.String(128), nullable=True, unique=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolved_by', sa.String(64), nullable=True),
    )
    op.create_index('ix_incidents_kind', 'incidents', ['kind'])
    op.create_index('ix_incidents_status', 'incidents', ['status'])
    op.create_index('ix_incidents_order_id', 'incidents', ['order_id'])

    op.create_table(
        'refunds',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('order_id', sa.Integer(), sa.ForeignKey('orders.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('payment_id', sa.Integer(), sa.ForeignKey('payments.id', ondelete='SET NULL'), nullable=True),
        sa.Column('amount', sa.Numeric(12, 2), nullable=False),
        sa.Column('method', sa.String(16), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('reason', sa.String(500), nullable=False, server_default=''),
        sa.Column('requested_by', sa.String(64), nullable=False),
        sa.Column('approved_by', sa.String(64), nullable=True),
        sa.Column('provider_ref', sa.String(255), nullable=True),
        sa.Column('error', sa.String(500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint('amount > 0', name='ck_refunds_amount_positive'),
    )
    op.create_index('ix_refunds_order_id', 'refunds', ['order_id'])

    op.create_table(
        'notification_templates',
        sa.Column('key', sa.String(48), primary_key=True),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('button_text', sa.String(64), nullable=False, server_default=''),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False),
    )


def downgrade() -> None:
    op.drop_table('notification_templates')
    op.drop_index('ix_refunds_order_id', table_name='refunds')
    op.drop_table('refunds')
    for ix in ('ix_incidents_order_id', 'ix_incidents_status', 'ix_incidents_kind'):
        op.drop_index(ix, table_name='incidents')
    op.drop_table('incidents')
    op.drop_table('task_runs')
    op.drop_index('ix_jobs_status_run_at', table_name='jobs')
    op.drop_table('jobs')
    op.drop_index('ix_stock_movements_created_at', table_name='stock_movements')
    op.drop_index('ix_stock_movements_product_id', table_name='stock_movements')
    op.drop_table('stock_movements')
    op.drop_index('ix_inventory_items_order_id', table_name='inventory_items')
    op.drop_index('ix_inventory_product_status', table_name='inventory_items')
    op.drop_table('inventory_items')
    op.drop_index('ix_support_tickets_order_id', table_name='support_tickets')
    op.drop_constraint('fk_support_tickets_order', 'support_tickets', type_='foreignkey')
    for col in ('priority', 'category', 'order_id'):
        op.drop_column('support_tickets', col)
    op.drop_index('ix_orders_fulfillment_status', table_name='orders')
    op.drop_constraint('uq_orders_public_id', 'orders', type_='unique')
    for col in ('delivered_at', 'fulfillment_error', 'fulfillment_attempts', 'fulfillment_status', 'currency', 'public_id'):
        op.drop_column('orders', col)
    op.drop_column('products', 'uses_inventory')
    op.drop_column('products', 'fulfillment_mode')
