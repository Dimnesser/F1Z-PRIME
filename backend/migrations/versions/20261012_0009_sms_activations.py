"""SMS-activation service: virtual numbers that receive one confirmation code, with resilient delivery.

Additive only. Integrates into the existing users/orders/ledger — it does NOT create a parallel users or
transactions table. Introduces:
  * `sms_activations` — one row per bought number, with a lease (owner + generation) for crash-safe polling
    and the full status machine (RESERVED → API_PENDING → WAITING → COMPLETED, plus CANCEL_REQUESTED,
    CANCELLED, TIMEOUT, FAILED, RECONCILIATION_REQUIRED). A partial unique index allows at most one active
    activation per user.
  * `delivery_outbox` — transactional outbox so a received code is delivered to the buyer exactly as reliably
    as it is stored (states PENDING → SENT, with UNKNOWN for indeterminate Telegram sends that need an
    audited, guarded retry).

This is a standard SMS-activation reseller model (a number that receives ONE SMS for a third-party signup).
It never reads or forwards Telegram login codes or .session data.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-12 12:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0009'
down_revision: Union[str, None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ACTIVE_STATUSES = ('RESERVED', 'API_PENDING', 'WAITING', 'CANCEL_REQUESTED', 'RECONCILIATION_REQUIRED')


def upgrade() -> None:
    op.create_table(
        'sms_activations',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('chat_id', sa.BigInteger(), nullable=False),
        sa.Column('order_id', sa.Integer(), sa.ForeignKey('orders.id', ondelete='SET NULL'), nullable=True),
        sa.Column('provider', sa.String(32), nullable=False, server_default='sms_activate'),
        sa.Column('service', sa.String(32), nullable=False, server_default=''),
        sa.Column('country', sa.String(8), nullable=False, server_default=''),
        sa.Column('activation_id', sa.String(64), nullable=True),  # provider id; unique when present
        sa.Column('phone_number', sa.String(32), nullable=True),
        # RESERVED|API_PENDING|WAITING|COMPLETED|CANCEL_REQUESTED|CANCELLED|TIMEOUT|FAILED|RECONCILIATION_REQUIRED
        sa.Column('status', sa.String(32), nullable=False, server_default='RESERVED'),
        sa.Column('code', sa.String(32), nullable=True),
        sa.Column('cost', sa.Numeric(10, 2), nullable=False, server_default='0'),
        sa.Column('refunded', sa.Boolean(), nullable=False, server_default='false'),  # refund-once guard
        sa.Column('events', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), onupdate=sa.text('now()'), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('lease_owner', sa.String(64), nullable=True),
        sa.Column('lease_expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('lease_generation', sa.BigInteger(), nullable=False, server_default='0'),
    )
    # provider activation id is unique when set (two rows cannot claim the same provider activation)
    op.create_index('ux_sms_activations_activation_id', 'sms_activations', ['activation_id'],
                    unique=True, postgresql_where=sa.text('activation_id IS NOT NULL'))
    # at most one in-flight activation per user — blocks a second order while one is unfinished
    op.create_index('ux_sms_activations_one_active_per_user', 'sms_activations', ['user_id'],
                    unique=True, postgresql_where=sa.text(
                        "status IN ('RESERVED','API_PENDING','WAITING','CANCEL_REQUESTED','RECONCILIATION_REQUIRED')"))
    # worker claim scan: poll WAITING/API_PENDING rows whose lease is free or expired
    op.create_index('ix_sms_activations_status_lease', 'sms_activations', ['status', 'lease_expires_at'])

    op.create_table(
        'delivery_outbox',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('sms_activation_id', sa.BigInteger(), sa.ForeignKey('sms_activations.id', ondelete='CASCADE'), nullable=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('chat_id', sa.BigInteger(), nullable=False),
        sa.Column('kind', sa.String(32), nullable=False, server_default='activation_code'),
        sa.Column('text', sa.Text(), nullable=False, server_default=''),
        # PENDING | SENT | UNKNOWN | FAILED
        sa.Column('status', sa.String(16), nullable=False, server_default='PENDING'),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('dedupe_key', sa.String(128), nullable=False),
        sa.Column('last_error', sa.String(500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), onupdate=sa.text('now()'), nullable=False),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ux_delivery_outbox_dedupe', 'delivery_outbox', ['dedupe_key'], unique=True)
    op.create_index('ix_delivery_outbox_status', 'delivery_outbox', ['status'])


def downgrade() -> None:
    op.drop_index('ix_delivery_outbox_status', table_name='delivery_outbox')
    op.drop_index('ux_delivery_outbox_dedupe', table_name='delivery_outbox')
    op.drop_table('delivery_outbox')
    op.drop_index('ix_sms_activations_status_lease', table_name='sms_activations')
    op.drop_index('ux_sms_activations_one_active_per_user', table_name='sms_activations')
    op.drop_index('ux_sms_activations_activation_id', table_name='sms_activations')
    op.drop_table('sms_activations')
