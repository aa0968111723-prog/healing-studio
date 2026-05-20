-- Timeline Frame Upload & Consistency Checking
-- 時間軸圖幀表

CREATE TABLE IF NOT EXISTS `timeline_frames` (
  `id` int(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `storyboard_id` int(11) NOT NULL,
  `scene_id` varchar(64) NOT NULL,
  `user_id` int(11) NOT NULL,
  `time_offset_sec` decimal(10,2) NOT NULL,
  `image_url` varchar(2048) NOT NULL,
  `frame_type` enum('keyframe', 'concept_art', 'reference', 'storyboard_sketch', 'final_render') NOT NULL DEFAULT 'keyframe',
  `title` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `tags` json DEFAULT NULL,
  `consistency_check_json` json DEFAULT NULL COMMENT '一致性檢查結果（JSON）',
  `uploaded_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_storyboard` (`storyboard_id`),
  KEY `idx_scene` (`scene_id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_time` (`time_offset_sec`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Scene Composition (Multi-Character/Scene Assembly)
-- 多角色多場景構圖表

CREATE TABLE IF NOT EXISTS `scene_compositions` (
  `id` int(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `world_id` int(11) NOT NULL,
  `storyboard_id` int(11) DEFAULT NULL,
  `user_id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `canvas_width` int(11) NOT NULL DEFAULT 1920,
  `canvas_height` int(11) NOT NULL DEFAULT 1080,
  `background_scene_id` varchar(64) DEFAULT NULL,
  `background_image_url` varchar(2048) DEFAULT NULL,
  `elements_json` json NOT NULL COMMENT '合成元素（角色、物件等）',
  `ai_suggestions_json` json DEFAULT NULL COMMENT 'AI 構圖建議',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_world` (`world_id`),
  KEY `idx_storyboard` (`storyboard_id`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
