CREATE TABLE IF NOT EXISTS training_progress (
  user_id INTEGER NOT NULL,
  topic TEXT NOT NULL,
  task_index INTEGER NOT NULL,
  solved_at INTEGER NOT NULL,
  PRIMARY KEY (user_id,topic,task_index)
);
