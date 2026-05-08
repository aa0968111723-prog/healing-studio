-- Migration: 0027_agent_collaboration_persistence.sql
-- Description: Add database persistence for multi-agent collaboration sessions
-- Date: 2026-05-07

-- Table: agent_collaboration_sessions
-- Stores multi-agent collaboration sessions with their metadata
CREATE TABLE IF NOT EXISTS agent_collaboration_sessions (
  collaboration_id VARCHAR(64) PRIMARY KEY,
  user_id INT NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  task_description TEXT NOT NULL,
  status ENUM('active', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'active',
  initiating_agent VARCHAR(32) NOT NULL,
  current_agent VARCHAR(32),
  participating_agents JSON NOT NULL COMMENT 'Array of AgentRole participating in collaboration',
  required_capabilities JSON COMMENT 'Array of required agent capabilities',
  shared_context JSON COMMENT 'Shared context object passed between agents',
  result JSON COMMENT 'Final collaboration result when completed',
  started_at BIGINT NOT NULL COMMENT 'Unix timestamp in milliseconds',
  completed_at BIGINT COMMENT 'Unix timestamp in milliseconds when completed',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_status (user_id, status),
  INDEX idx_session_id (session_id),
  INDEX idx_started_at (started_at DESC),
  INDEX idx_status (status),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

-- Table: agent_collaboration_steps
-- Tracks individual steps within a collaboration workflow
CREATE TABLE IF NOT EXISTS agent_collaboration_steps (
  step_id VARCHAR(64) PRIMARY KEY,
  collaboration_id VARCHAR(64) NOT NULL,
  step_order INT NOT NULL COMMENT 'Execution order within the collaboration',
  agent_role VARCHAR(32) NOT NULL,
  step_description TEXT COMMENT 'What this step is supposed to accomplish',
  tool_name VARCHAR(64) COMMENT 'Tool being executed in this step',
  tool_args JSON COMMENT 'Arguments passed to the tool',
  dependencies JSON COMMENT 'Array of step_ids this step depends on',
  step_result JSON COMMENT 'Result/output from this step',
  status ENUM('pending', 'in_progress', 'completed', 'failed', 'skipped') NOT NULL DEFAULT 'pending',
  error_message TEXT COMMENT 'Error message if step failed',
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 3,
  started_at BIGINT COMMENT 'Unix timestamp in milliseconds',
  completed_at BIGINT COMMENT 'Unix timestamp in milliseconds',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_collab_order (collaboration_id, step_order),
  INDEX idx_collab_status (collaboration_id, status),
  INDEX idx_agent_role (agent_role),
  INDEX idx_status (status),
  FOREIGN KEY (collaboration_id) REFERENCES agent_collaboration_sessions(collaboration_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

-- Table: agent_collaboration_messages
-- Stores inter-agent communication messages for debugging and audit
CREATE TABLE IF NOT EXISTS agent_collaboration_messages (
  message_id VARCHAR(64) PRIMARY KEY,
  collaboration_id VARCHAR(64),
  from_agent VARCHAR(32) NOT NULL,
  to_agent VARCHAR(255) NOT NULL COMMENT 'Can be single agent, broadcast, or array',
  message_type ENUM('request', 'response', 'notification', 'handoff', 'broadcast', 'query', 'share_context') NOT NULL,
  priority ENUM('low', 'normal', 'high', 'urgent') NOT NULL DEFAULT 'normal',
  content JSON NOT NULL COMMENT 'Message content with action and data',
  correlation_id VARCHAR(64) COMMENT 'Links related messages together',
  timestamp BIGINT NOT NULL COMMENT 'Unix timestamp in milliseconds',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_collab_timestamp (collaboration_id, timestamp DESC),
  INDEX idx_correlation (correlation_id),
  INDEX idx_from_agent (from_agent),
  INDEX idx_to_agent (to_agent),
  INDEX idx_timestamp (timestamp DESC),
  FOREIGN KEY (collaboration_id) REFERENCES agent_collaboration_sessions(collaboration_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

-- Table: agent_collaboration_handoffs
-- Tracks control handoffs between agents
CREATE TABLE IF NOT EXISTS agent_collaboration_handoffs (
  handoff_id VARCHAR(64) PRIMARY KEY,
  collaboration_id VARCHAR(64) NOT NULL,
  from_agent VARCHAR(32) NOT NULL,
  to_agent VARCHAR(32) NOT NULL,
  handoff_reason TEXT COMMENT 'Why the handoff occurred',
  context_transferred JSON COMMENT 'What context was passed to the new agent',
  timestamp BIGINT NOT NULL COMMENT 'Unix timestamp in milliseconds',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_collab_timestamp (collaboration_id, timestamp DESC),
  INDEX idx_from_to (from_agent, to_agent),
  FOREIGN KEY (collaboration_id) REFERENCES agent_collaboration_sessions(collaboration_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

-- Table: agent_performance_metrics
-- Aggregated performance metrics per agent type
CREATE TABLE IF NOT EXISTS agent_performance_metrics (
  metric_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  agent_role VARCHAR(32) NOT NULL,
  metric_date DATE NOT NULL COMMENT 'Aggregation date',
  total_collaborations INT NOT NULL DEFAULT 0,
  successful_steps INT NOT NULL DEFAULT 0,
  failed_steps INT NOT NULL DEFAULT 0,
  avg_step_duration_ms BIGINT COMMENT 'Average step execution time',
  total_tool_invocations INT NOT NULL DEFAULT 0,
  tool_success_rate DECIMAL(5,2) COMMENT 'Percentage of successful tool calls',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_agent_date (agent_role, metric_date),
  INDEX idx_agent_date (agent_role, metric_date DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
