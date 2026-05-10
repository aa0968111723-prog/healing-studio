-- Migration: 0038_perf_indexes_and_batch
-- Adds the missing composite index on orb_conversations(user_id, created_at)
-- for efficient cursor-based pagination queries.
-- All other indexes referenced in the performance optimisation PR already
-- exist from earlier migrations; this file only adds the net-new one.

ALTER TABLE `orb_conversations`
  ADD INDEX `orbc_user_createdAt_idx` (`user_id`, `created_at`);
