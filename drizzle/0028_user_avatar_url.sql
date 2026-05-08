-- 0028: Add avatarUrl column to users for the virtual-avatar feature.
-- Stores either a preset id (e.g. "preset:cosmic-fox"), a remote AI-generated
-- image URL, or a data URL (kept ≤ 64 KB). Null = render initials fallback.

ALTER TABLE `users`
  ADD COLUMN `avatarUrl` text;
