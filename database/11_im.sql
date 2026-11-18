USE travel_agent_db;

CREATE TABLE IF NOT EXISTS im_conversation (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_no VARCHAR(32) NOT NULL,
  conversation_type ENUM('DIRECT','GROUP') NOT NULL DEFAULT 'DIRECT',
  title VARCHAR(100) NULL,
  last_message_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_message_at DATETIME(3) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_im_conversation_no (conversation_no),
  KEY idx_im_conversation_activity (last_message_at),
  CONSTRAINT fk_im_conv_creator FOREIGN KEY (created_by) REFERENCES sys_user(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS im_participant (
  conversation_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('OWNER','MEMBER') NOT NULL DEFAULT 'MEMBER',
  joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_read_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
  muted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id),
  KEY idx_im_participant_user (user_id),
  CONSTRAINT fk_im_participant_conversation FOREIGN KEY (conversation_id) REFERENCES im_conversation(id) ON DELETE CASCADE,
  CONSTRAINT fk_im_participant_user FOREIGN KEY (user_id) REFERENCES sys_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS im_message (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  sender_id BIGINT UNSIGNED NOT NULL,
  seq BIGINT UNSIGNED NOT NULL,
  client_msg_id VARCHAR(64) NOT NULL,
  content_type ENUM('TEXT','SYSTEM') NOT NULL DEFAULT 'TEXT',
  content TEXT NOT NULL,
  status ENUM('SENT','RECALLED') NOT NULL DEFAULT 'SENT',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_im_message_sender_client (sender_id, client_msg_id),
  UNIQUE KEY uk_im_message_seq (conversation_id, seq),
  KEY idx_im_message_list (conversation_id, seq),
  CONSTRAINT fk_im_message_conversation FOREIGN KEY (conversation_id) REFERENCES im_conversation(id) ON DELETE CASCADE,
  CONSTRAINT fk_im_message_sender FOREIGN KEY (sender_id) REFERENCES sys_user(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS im_device (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  platform ENUM('WEB','IOS','ANDROID') NOT NULL DEFAULT 'WEB',
  last_seen_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_im_device_user_device (user_id, device_id),
  CONSTRAINT fk_im_device_user FOREIGN KEY (user_id) REFERENCES sys_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS im_read_cursor (
  conversation_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  last_read_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_read_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (conversation_id, user_id),
  CONSTRAINT fk_im_cursor_conversation FOREIGN KEY (conversation_id) REFERENCES im_conversation(id) ON DELETE CASCADE,
  CONSTRAINT fk_im_cursor_user FOREIGN KEY (user_id) REFERENCES sys_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
