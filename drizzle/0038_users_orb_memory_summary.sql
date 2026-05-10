-- 0038: Add orbMemorySummary column to users for Orb global condensed memory.
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `orbMemorySummary` text;
