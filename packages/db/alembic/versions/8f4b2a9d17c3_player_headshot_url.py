"""player headshot url

Revision ID: 8f4b2a9d17c3
Revises: 20cdfefbc4a5
Create Date: 2026-07-01 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '8f4b2a9d17c3'
down_revision: Union[str, None] = '20cdfefbc4a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('players', sa.Column('headshot_url', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('players', 'headshot_url')
