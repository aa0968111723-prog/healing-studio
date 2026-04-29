import { sql } from "drizzle-orm";

export const up = sql`
CREATE TABLE IF NOT EXISTS agent_preferences (
  userId int NOT NULL,
  confirmationPolicy enum('always_approve','confirm_high_risk','confirm_all','manual') NOT NULL DEFAULT 'confirm_high_risk',
  allowedRiskLevels json NOT NULL,
  autoApproveTools json NOT NULL,
  blockedTools json NOT NULL,
  maxAutoStepsPerTask int NOT NULL DEFAULT 5,
  notifyOnCompletion boolean NOT NULL DEFAULT true,
  notifyOnError boolean NOT NULL DEFAULT true,
  createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (userId)
);
`;
