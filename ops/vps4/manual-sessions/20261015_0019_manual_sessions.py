"""Manually uploaded sessions for the accounts product and premium numbers (kept out of phone stock).

Additive only.
"""
from alembic import op
import sqlalchemy as sa

revision = '0019'
down_revision = '0018'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'manual_sessions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('filename', sa.String(255), nullable=False),
        sa.Column('purpose', sa.String(16), nullable=False),
        sa.Column('phone_e164', sa.String(24), nullable=False),
        sa.Column('product_id', sa.Integer(), sa.ForeignKey('products.id', ondelete='SET NULL'), nullable=True),
        sa.Column('premium_number_id', sa.Integer(), sa.ForeignKey('premium_numbers.id', ondelete='CASCADE'), nullable=True),
        sa.Column('two_fa_enc', sa.Text(), nullable=True),
        sa.Column('added_by', sa.String(128), nullable=False, server_default=''),
        sa.Column('delivered_order_id', sa.Integer(), sa.ForeignKey('orders.id', ondelete='SET NULL'), nullable=True),
        sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('filename', name='uq_manual_sessions_filename'),
        sa.UniqueConstraint('premium_number_id', name='uq_manual_sessions_premium'),
        sa.CheckConstraint("purpose IN ('account','premium')", name='ck_manual_sessions_purpose'),
    )
    op.create_index('ix_manual_sessions_phone', 'manual_sessions', ['phone_e164'])


def downgrade():
    op.drop_index('ix_manual_sessions_phone', table_name='manual_sessions')
    op.drop_table('manual_sessions')
