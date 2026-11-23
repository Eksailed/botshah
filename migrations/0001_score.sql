ALTER TABLE rooms ADD COLUMN result TEXT;
CREATE INDEX IF NOT EXISTS rooms_pair_score ON rooms (white, black) WHERE result IS NOT NULL;
