"""drop pgvector embedding columns (no vector search in V1)

Entity resolution is pg_trgm fuzzy match and the answer cache is keyed by
normalized text; neither uses embeddings. Drop the write-only vector columns
and their HNSW indexes. (The `vector` extension is left enabled — harmless, and
avoids reordering the initial migration.)

Revision ID: 5d3a7e0c1b28
Revises: 4c8e1f2b6d90
Create Date: 2026-07-02 00:15:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy


revision: str = '5d3a7e0c1b28'
down_revision: Union[str, None] = '4c8e1f2b6d90'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index('entity_aliases_embedding_idx', table_name='entity_aliases',
                  postgresql_using='hnsw',
                  postgresql_ops={'embedding': 'vector_cosine_ops'})
    op.drop_column('entity_aliases', 'embedding')
    op.drop_index('answer_cache_embedding_idx', table_name='answer_cache',
                  postgresql_using='hnsw',
                  postgresql_ops={'embedding': 'vector_cosine_ops'})
    op.drop_column('answer_cache', 'embedding')


def downgrade() -> None:
    op.add_column('answer_cache',
                  sa.Column('embedding', pgvector.sqlalchemy.Vector(dim=1536), nullable=True))
    op.create_index('answer_cache_embedding_idx', 'answer_cache', ['embedding'],
                    unique=False, postgresql_using='hnsw',
                    postgresql_ops={'embedding': 'vector_cosine_ops'})
    op.add_column('entity_aliases',
                  sa.Column('embedding', pgvector.sqlalchemy.Vector(dim=1536), nullable=True))
    op.create_index('entity_aliases_embedding_idx', 'entity_aliases', ['embedding'],
                    unique=False, postgresql_using='hnsw',
                    postgresql_with={'m': 16, 'ef_construction': 64},
                    postgresql_ops={'embedding': 'vector_cosine_ops'})
