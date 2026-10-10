"""admin panel: admin accounts, order history, categories, notification outbox, ticket assignment

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-10 17:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0002'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TS = dict(server_default=sa.text('now()'), nullable=False)


def upgrade() -> None:
    op.create_table(
        'admin_users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('username', sa.String(length=64), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('role', sa.Enum('owner', 'admin', 'support', name='admin_role', native_enum=False, length=32), nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), **TS),
        sa.Column('updated_at', sa.DateTime(timezone=True), **TS),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('username'),
    )
    op.create_table(
        'order_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('order_id', sa.Integer(), nullable=False),
        sa.Column('from_status', sa.String(length=32), nullable=True),
        sa.Column('to_status', sa.String(length=32), nullable=False),
        sa.Column('actor', sa.String(length=64), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), **TS),
        sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_order_events_order_id'), 'order_events', ['order_id'], unique=False)
    categories = op.create_table(
        'categories',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('slug', sa.String(length=32), nullable=False),
        sa.Column('title', sa.String(length=64), nullable=False),
        sa.Column('icon', sa.String(length=32), server_default='box', nullable=False),
        sa.Column('sort_order', sa.Integer(), server_default='100', nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), **TS),
        sa.Column('updated_at', sa.DateTime(timezone=True), **TS),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('slug'),
    )
    op.bulk_insert(categories, [
        {'slug': 'numbers', 'title': 'Номера по странам', 'icon': 'globe', 'sort_order': 10},
        {'slug': 'digital', 'title': 'Цифровые товары', 'icon': 'sparkles', 'sort_order': 20},
        {'slug': 'services', 'title': 'Сервисы', 'icon': 'zap', 'sort_order': 30},
    ])
    op.create_table(
        'notification_outbox',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('chat_id', sa.BigInteger(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('status', sa.String(length=16), server_default='pending', nullable=False),
        sa.Column('attempts', sa.Integer(), server_default='1', nullable=False),
        sa.Column('last_error', sa.String(length=255), server_default='', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), **TS),
        sa.Column('next_attempt_at', sa.DateTime(timezone=True), **TS),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_notification_outbox_status'), 'notification_outbox', ['status'], unique=False)
    op.add_column('support_tickets', sa.Column('assigned_to', sa.String(length=64), nullable=True))
    op.create_index(op.f('ix_support_tickets_assigned_to'), 'support_tickets', ['assigned_to'], unique=False)
    # Orders / payments created_at are used for date filters in reports.
    op.create_index('ix_payments_created_at', 'payments', ['created_at'], unique=False)
    op.create_index('ix_orders_paid_at', 'orders', ['paid_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_orders_paid_at', table_name='orders')
    op.drop_index('ix_payments_created_at', table_name='payments')
    op.drop_index(op.f('ix_support_tickets_assigned_to'), table_name='support_tickets')
    op.drop_column('support_tickets', 'assigned_to')
    op.drop_index(op.f('ix_notification_outbox_status'), table_name='notification_outbox')
    op.drop_table('notification_outbox')
    op.drop_table('categories')
    op.drop_index(op.f('ix_order_events_order_id'), table_name='order_events')
    op.drop_table('order_events')
    op.drop_table('admin_users')
