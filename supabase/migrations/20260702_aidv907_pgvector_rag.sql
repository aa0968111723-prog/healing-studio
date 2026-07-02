-- AIDV-907: RAG 向量記憶後端選型 — 採 Supabase pgvector 取代 Pinecone
--
-- 建立兩張向量表（對應 ragMemory.ts / teachingArchiveRag.ts 原本的兩個
-- Pinecone namespace 家族）＋ HNSW 索引＋兩個唯 service_role 可呼叫的
-- 相似度檢索 RPC。
--
-- 設計要點：
--   * embedding 維度 3072（gemini-embedding-001 原生輸出；與
--     server/services/ragMemory.ts:EMBEDDING_DIM 對齊，勿單方修改）。
--   * pgvector 的 hnsw / ivfflat 索引上限 2000 維，因此索引建在
--     halfvec(3072) 表達式上（pgvector >= 0.7；Supabase 內建 0.7+）。
--     查詢端（RPC）用同一個 `embedding::halfvec(3072)` 表達式排序，
--     才吃得到索引。
--   * RLS 啟用且不建 policy：資料只由 server 以 service_role
--     （bypassrls）經 PostgREST 讀寫；anon / authenticated 全 REVOKE
--     （沿用 AIDV-409 / AIDV-318b 的存取收斂模式）。
--   * RPC 為 security invoker、固定 search_path，EXECUTE 只留給
--     service_role（沿用 AIDV-721/722 的函式權限模式）。
--   * 本檔僅為 migration 檔，不在部署流程自動執行；未套用前 server
--     端查詢會失敗並自動降級（讀 Pinecone 或回空），不影響既有行為。

-- Supabase 慣例：vector extension 裝在 extensions schema；
-- DB 預設 search_path（"$user", public, extensions）可直接解析 vector 型別。
create extension if not exists vector with schema extensions;

-- ─── 1. 用戶生成記憶向量（原 Pinecone namespace: user-{userId}）──────────

create table if not exists public.rag_memory_vectors (
  -- 沿用 Pinecone vector id 格式：user-{userId}-gen-{generationId}
  id text primary key,
  user_id bigint not null,
  generation_id bigint,
  prompt text not null default '',
  generation_type text not null default '',
  vibe_card_ids text not null default '',
  rating integer not null default 0,
  embedding vector(3072) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.rag_memory_vectors is
  'AIDV-907 RAG 用戶創作記憶向量（gemini-embedding-001, 3072 維）。原 Pinecone user-{userId} namespace 的 pgvector 對應表。';

create index if not exists rag_memory_vectors_user_id_idx
  on public.rag_memory_vectors (user_id);

-- 3072 維超過 hnsw 的 2000 維上限 → 建在 halfvec 表達式上（cosine）。
create index if not exists rag_memory_vectors_embedding_hnsw_idx
  on public.rag_memory_vectors
  using hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

alter table public.rag_memory_vectors enable row level security;
revoke all on table public.rag_memory_vectors from anon, authenticated;

-- ─── 2. 資料庫（教材）chunk 向量（原 Pinecone namespace: teaching-{userId}）─

create table if not exists public.rag_teaching_chunks (
  -- 沿用 Pinecone vector id 格式：teaching-{userId}-mat-{materialId}-c{chunkIndex}
  id text primary key,
  user_id bigint not null,
  material_id bigint not null,
  team_id bigint not null default 0,
  visibility text not null default '',
  media_type text not null default '',
  title text not null default '',
  lineage text not null default '',
  topic text not null default '',
  speaker text not null default '',
  source_type text not null default '',
  chunk_index integer not null default 0,
  chunk_text text not null default '',
  embedding vector(3072) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.rag_teaching_chunks is
  'AIDV-907 RAG 教材切片向量（gemini-embedding-001, 3072 維）。原 Pinecone teaching-{userId} namespace 的 pgvector 對應表。';

create index if not exists rag_teaching_chunks_user_material_idx
  on public.rag_teaching_chunks (user_id, material_id);

create index if not exists rag_teaching_chunks_embedding_hnsw_idx
  on public.rag_teaching_chunks
  using hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

alter table public.rag_teaching_chunks enable row level security;
revoke all on table public.rag_teaching_chunks from anon, authenticated;

-- ─── 3. 相似度檢索 RPC ────────────────────────────────────────────────────
-- p_embedding 以 text 傳（'[0.1,0.2,...]' pgvector 字面量），PostgREST →
-- text → vector cast 最穩，避免 JSON 陣列型別推斷差異。
-- score = 1 - cosine distance，與 Pinecone cosine metric 的分數語意一致。

create or replace function public.rag_match_memories(
  p_user_id bigint,
  p_embedding text,
  p_top_k integer default 3
)
returns table (
  id text,
  score double precision,
  prompt text,
  generation_type text,
  vibe_card_ids text,
  rating integer,
  ts bigint
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    v.id,
    1 - (v.embedding::halfvec(3072) <=> (p_embedding::vector(3072))::halfvec(3072))::double precision as score,
    v.prompt,
    v.generation_type,
    v.vibe_card_ids,
    v.rating,
    (extract(epoch from v.created_at) * 1000)::bigint as ts
  from public.rag_memory_vectors v
  where v.user_id = p_user_id
  order by v.embedding::halfvec(3072) <=> (p_embedding::vector(3072))::halfvec(3072)
  limit greatest(1, least(coalesce(p_top_k, 3), 50))
$$;

revoke all on function public.rag_match_memories(bigint, text, integer) from public;
revoke execute on function public.rag_match_memories(bigint, text, integer) from anon, authenticated;
grant execute on function public.rag_match_memories(bigint, text, integer) to service_role;

create or replace function public.rag_match_teaching_chunks(
  p_user_id bigint,
  p_embedding text,
  p_top_k integer default 20
)
returns table (
  material_id bigint,
  score double precision,
  chunk_index integer,
  chunk_text text,
  title text,
  lineage text,
  topic text
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    c.material_id,
    1 - (c.embedding::halfvec(3072) <=> (p_embedding::vector(3072))::halfvec(3072))::double precision as score,
    c.chunk_index,
    c.chunk_text,
    c.title,
    c.lineage,
    c.topic
  from public.rag_teaching_chunks c
  where c.user_id = p_user_id
  order by c.embedding::halfvec(3072) <=> (p_embedding::vector(3072))::halfvec(3072)
  limit greatest(1, least(coalesce(p_top_k, 20), 50))
$$;

revoke all on function public.rag_match_teaching_chunks(bigint, text, integer) from public;
revoke execute on function public.rag_match_teaching_chunks(bigint, text, integer) from anon, authenticated;
grant execute on function public.rag_match_teaching_chunks(bigint, text, integer) to service_role;
