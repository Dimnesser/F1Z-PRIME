"""Buyer reviews of received orders (rating 1-5 + optional comment, one per order).

Additive only.
"""
from alembic import op
import sqlalchemy as sa

revision = '0018'
down_revision = '0017'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'order_reviews',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('order_id', sa.Integer(), sa.ForeignKey('orders.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('product_id', sa.Integer(), sa.ForeignKey('products.id', ondelete='SET NULL'), nullable=True),
        sa.Column('rating', sa.Integer(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('order_id', name='uq_order_reviews_order'),
        sa.CheckConstraint('rating BETWEEN 1 AND 5', name='ck_order_reviews_rating'),
    )
    op.create_index('ix_order_reviews_product', 'order_reviews', ['product_id'])
    op.create_index('ix_order_reviews_created', 'order_reviews', ['created_at'])


def downgrade():
    op.drop_index('ix_order_reviews_created', table_name='order_reviews')
    op.drop_index('ix_order_reviews_product', table_name='order_reviews')
    op.drop_table('order_reviews')
