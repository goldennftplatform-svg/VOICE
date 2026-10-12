CREATE TABLE IF NOT EXISTS preview_votes (
    clip_id TEXT NOT NULL,
    voter_hash TEXT NOT NULL,
    value INTEGER NOT NULL CHECK (value IN (-1, 1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (clip_id, voter_hash)
);
CREATE INDEX IF NOT EXISTS preview_votes_by_voter ON preview_votes(voter_hash);
