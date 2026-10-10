"""admin_users.telegram_id: open the admin panel from the Telegram Mini App

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-10 20:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0003'
down_revision: Union[str, None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('admin_users', sa.Column('telegram_id', sa.BigInteger(), nullable=True))
    op.create_unique_constraint('uq_admin_users_telegram_id', 'admin_users', ['telegram_id'])


def downgrade() -> None:
    op.drop_constraint('uq_admin_users_telegram_id', 'admin_users', type_='unique')
    op.drop_column('admin_users', 'telegram_id')
