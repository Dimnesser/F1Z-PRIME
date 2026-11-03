"""RBAC: roles with permissions/limits, extended staff accounts, approvals, staff inbox, admin UI prefs

Existing staff accounts are kept: role admin -> "admin", support -> "support", owner -> "head_admin".

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-11 11:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0005'
down_revision: Union[str, None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NOW = sa.text('now()')


def upgrade() -> None:
    op.create_table(
        'roles',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('slug', sa.String(32), nullable=False, unique=True),
        sa.Column('name', sa.String(64), nullable=False),
        sa.Column('description', sa.String(255), nullable=False, server_default=''),
        sa.Column('color', sa.String(16), nullable=False, server_default='#8B5CF6'),
        sa.Column('permissions', sa.JSON(), nullable=False),
        sa.Column('limits', sa.JSON(), nullable=False),
        sa.Column('is_system', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('updated_by', sa.String(64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False),
    )
    op.add_column('admin_users', sa.Column('role_slug', sa.String(32), nullable=True))
    op.add_column('admin_users', sa.Column('display_name', sa.String(64), nullable=True))
    op.add_column('admin_users', sa.Column('telegram_username', sa.String(64), nullable=True))
    op.add_column('admin_users', sa.Column('extra_permissions', sa.JSON(), nullable=True))
    op.add_column('admin_users', sa.Column('denied_permissions', sa.JSON(), nullable=True))
    op.add_column('admin_users', sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('admin_users', sa.Column('token_version', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('admin_users', sa.Column('note', sa.String(255), nullable=True))
    op.add_column('admin_users', sa.Column('version', sa.Integer(), nullable=False, server_default='1'))
    op.alter_column('admin_users', 'password_hash', existing_type=sa.String(255), nullable=True)
    op.execute("UPDATE admin_users SET role_slug = CASE role WHEN 'admin' THEN 'admin' WHEN 'owner' THEN 'head_admin' ELSE 'support' END")
    op.alter_column('admin_users', 'role_slug', existing_type=sa.String(32), nullable=False)

    op.create_table(
        'approval_requests',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('kind', sa.String(32), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('amount', sa.Numeric(12, 2), nullable=True),
        sa.Column('summary', sa.String(255), nullable=False),
        sa.Column('status', sa.String(16), nullable=False, server_default='pending'),
        sa.Column('requested_by', sa.String(64), nullable=False),
        sa.Column('decided_by', sa.String(64), nullable=True),
        sa.Column('decision_note', sa.String(255), nullable=True),
        sa.Column('result', sa.String(255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_approval_requests_status', 'approval_requests', ['status'])

    op.create_table(
        'staff_notifications',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('recipient', sa.String(64), nullable=False),
        sa.Column('kind', sa.String(48), nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('body', sa.Text(), nullable=False, server_default=''),
        sa.Column('link', sa.String(200), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_staff_notifications_recipient', 'staff_notifications', ['recipient', 'read_at'])

    op.create_table(
        'admin_prefs',
        sa.Column('owner_key', sa.String(64), primary_key=True),
        sa.Column('data', sa.JSON(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=NOW, nullable=False),
    )


def downgrade() -> None:
    op.drop_table('admin_prefs')
    op.drop_index('ix_staff_notifications_recipient', table_name='staff_notifications')
    op.drop_table('staff_notifications')
    op.drop_index('ix_approval_requests_status', table_name='approval_requests')
    op.drop_table('approval_requests')
    op.alter_column('admin_users', 'password_hash', existing_type=sa.String(255), nullable=False)
    for col in ('version', 'note', 'token_version', 'expires_at', 'denied_permissions', 'extra_permissions',
                'telegram_username', 'display_name', 'role_slug'):
        op.drop_column('admin_users', col)
    op.drop_table('roles')
