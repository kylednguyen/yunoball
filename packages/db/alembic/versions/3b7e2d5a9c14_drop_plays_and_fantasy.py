"""drop plays table + fantasy_points_ppr columns (out of V1 scope)

V1 is intentionally box-score grained: no play-by-play / EPA / win-probability,
and no fantasy. Drop the `plays` table and the fantasy_points_ppr columns from
player_game_stats and player_season_stats.

Revision ID: 3b7e2d5a9c14
Revises: 2a1c9f4b3e77
Create Date: 2026-07-02 00:05:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '3b7e2d5a9c14'
down_revision: Union[str, None] = '2a1c9f4b3e77'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index('plays_situational_idx', table_name='plays')
    op.drop_index('plays_game_idx', table_name='plays')
    op.drop_table('plays')
    op.drop_column('player_game_stats', 'fantasy_points_ppr')
    op.drop_column('player_season_stats', 'fantasy_points_ppr')


def downgrade() -> None:
    op.add_column('player_season_stats',
                  sa.Column('fantasy_points_ppr', sa.Float(), nullable=True))
    op.add_column('player_game_stats',
                  sa.Column('fantasy_points_ppr', sa.Float(), nullable=True))
    op.create_table(
        'plays',
        sa.Column('play_id', sa.String(), nullable=False),
        sa.Column('game_id', sa.String(), nullable=False),
        sa.Column('posteam', sa.String(), nullable=True),
        sa.Column('defteam', sa.String(), nullable=True),
        sa.Column('qtr', sa.SmallInteger(), nullable=True),
        sa.Column('down', sa.SmallInteger(), nullable=True),
        sa.Column('yards_to_go', sa.SmallInteger(), nullable=True),
        sa.Column('yardline_100', sa.SmallInteger(), nullable=True),
        sa.Column('play_type', sa.String(), nullable=True),
        sa.Column('yards_gained', sa.SmallInteger(), nullable=True),
        sa.Column('epa', sa.Float(), nullable=True),
        sa.Column('wp', sa.Float(), nullable=True),
        sa.Column('success', sa.Boolean(), nullable=True),
        sa.Column('passer_player_id', sa.String(), nullable=True),
        sa.Column('rusher_player_id', sa.String(), nullable=True),
        sa.Column('receiver_player_id', sa.String(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['defteam'], ['teams.team_id'], ),
        sa.ForeignKeyConstraint(['game_id'], ['games.game_id'], ),
        sa.ForeignKeyConstraint(['posteam'], ['teams.team_id'], ),
        sa.PrimaryKeyConstraint('play_id'),
    )
    op.create_index('plays_game_idx', 'plays', ['game_id'], unique=False)
    op.create_index('plays_situational_idx', 'plays', ['down', 'qtr', 'play_type'],
                    unique=False)
