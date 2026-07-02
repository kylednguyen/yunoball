"""drop query_examples (few-shot NL->SQL library removed)

The LLM no longer generates SQL — it only produces a validated QuerySpec — so
the verified question->SQL few-shot library is obsolete.

Revision ID: 2a1c9f4b3e77
Revises: 1e337a14d9ce
Create Date: 2026-07-02 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy


revision: str = '2a1c9f4b3e77'
down_revision: Union[str, None] = '1e337a14d9ce'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index('query_examples_embedding_idx', table_name='query_examples',
                  postgresql_using='hnsw',
                  postgresql_ops={'embedding': 'vector_cosine_ops'})
    op.drop_table('query_examples')


def downgrade() -> None:
    op.create_table(
        'query_examples',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('question', sa.Text(), nullable=False),
        sa.Column('sql', sa.Text(), nullable=False),
        sa.Column('tags', sa.ARRAY(sa.String()), nullable=True),
        sa.Column('verified', sa.Boolean(), nullable=False),
        sa.Column('embedding', pgvector.sqlalchemy.Vector(dim=1536), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('question'),
    )
    op.create_index('query_examples_embedding_idx', 'query_examples', ['embedding'],
                    unique=False, postgresql_using='hnsw',
                    postgresql_ops={'embedding': 'vector_cosine_ops'})
