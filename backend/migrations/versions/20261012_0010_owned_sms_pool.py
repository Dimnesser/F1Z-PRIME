"""Owned-number pool for SMS-activations: the operator rents out numbers they own to receive a registration
code for the buyer's OWN new signup. Plugs into the existing sms_activations engine as an alternative source.

Deliberately numbers-only: NO Telegram session/.session/TData storage, and nothing that relays a login code
for a pre-existing account. The code delivered is the incoming registration SMS that the operator's own SMS
gateway forwards to the ingest webhook.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-12 13:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0010'
down_revision: Union[str, None] = '0009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'owned_sms_numbers',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('phone_e164', sa.String(24), nullable=False),
        sa.Column('country_iso2', sa.String(2), nullable=False, server_default=''),
        sa.Column('service', sa.String(32), nullable=False, server_default=''),  # '' = any service
        sa.Column('price', sa.Numeric(10, 2), nullable=False, server_default='0'),  # operator-set sale price
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('in_use', sa.Boolean(), nullable=False, server_default='false'),  # currently rented out
        sa.Column('times_used', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('added_by', sa.String(64), nullable=False, server_default=''),
        sa.Column('note', sa.String(255), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ux_owned_sms_phone', 'owned_sms_numbers', ['phone_e164'], unique=True)
    # fast pick of a free, active number for a (country, service)
    op.create_index('ix_owned_sms_available', 'owned_sms_numbers', ['country_iso2', 'service'],
                    postgresql_where=sa.text('is_active = true AND in_use = false'))

    op.create_table(
        'owned_sms_inbox',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('number_id', sa.BigInteger(), sa.ForeignKey('owned_sms_numbers.id', ondelete='CASCADE'), nullable=True),
        sa.Column('phone_e164', sa.String(24), nullable=False),
        sa.Column('text', sa.Text(), nullable=False, server_default=''),
        sa.Column('code', sa.String(16), nullable=True),  # parsed confirmation code
        sa.Column('activation_id', sa.BigInteger(), sa.ForeignKey('sms_activations.id', ondelete='SET NULL'), nullable=True),
        sa.Column('consumed', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('received_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_owned_sms_inbox_phone', 'owned_sms_inbox', ['phone_e164', 'consumed'])


def downgrade() -> None:
    op.drop_index('ix_owned_sms_inbox_phone', table_name='owned_sms_inbox')
    op.drop_table('owned_sms_inbox')
    op.drop_index('ix_owned_sms_available', table_name='owned_sms_numbers')
    op.drop_index('ux_owned_sms_phone', table_name='owned_sms_numbers')
    op.drop_table('owned_sms_numbers')
