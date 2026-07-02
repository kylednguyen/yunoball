"""player_season_stats: add completions/attempts/targets/sacks

These back the widened stat whitelist — completion percentage and passer rating
(from completions/attempts), plus targets and sacks at the season grain.

Revision ID: 4c8e1f2b6d90
Revises: 3b7e2d5a9c14
Create Date: 2026-07-02 00:10:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '4c8e1f2b6d90'
down_revision: Union[str, None] = '3b7e2d5a9c14'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('player_season_stats', sa.Column('completions', sa.SmallInteger(), nullable=True))
    op.add_column('player_season_stats', sa.Column('attempts', sa.SmallInteger(), nullable=True))
    op.add_column('player_season_stats', sa.Column('sacks', sa.Float(), nullable=True))
    op.add_column('player_season_stats', sa.Column('targets', sa.SmallInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column('player_season_stats', 'targets')
    op.drop_column('player_season_stats', 'sacks')
    op.drop_column('player_season_stats', 'attempts')
    op.drop_column('player_season_stats', 'completions')
