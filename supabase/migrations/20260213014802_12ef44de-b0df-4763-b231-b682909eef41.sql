
-- Create HNSW index on chunks.embedding for scalable vector retrieval
-- This supports incremental indexing: new INSERTs are automatically indexed
-- Estimated build time: ~5-10 minutes for 500k chunks (one-time)
-- Expected query latency: <50ms for top-50 retrieval at 500k+ chunks
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw 
ON public.chunks 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
