-- A device can hold one shared organization next to its local workspaces.
--
-- The shared copy is a read replica in this phase: server rows are applied
-- through `sync.apply_changes`, never written by the coordinator screens. The
-- outbox columns are added now so the first write phase does not need a second
-- migration that has to preserve queued work.

CREATE TABLE shared_workspaces (
    organization_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'shared' CHECK (mode IN ('local', 'shared')),
    replica_id TEXT NOT NULL,
    membership_epoch INTEGER NOT NULL DEFAULT 0,
    cursor INTEGER NOT NULL DEFAULT 0 CHECK (cursor >= 0),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    last_successful_sync_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- One row per server entity. `payload` is the exact JSON the server sent, so a
-- read model can change without rewriting the replica. Deletes are tombstones:
-- removing the row would let a delayed insert resurrect it.
CREATE TABLE replica_entities (
    organization_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0,
    row_version INTEGER,
    deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
    payload TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, entity_type, entity_id)
);

CREATE INDEX replica_entities_type
    ON replica_entities(organization_id, entity_type, deleted);

CREATE INDEX replica_entities_sequence
    ON replica_entities(organization_id, sequence);

-- The version a command was built against. A later conflict envelope names
-- these values without re-reading the row that has already changed.
CREATE TABLE sync_entity_versions (
    organization_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    row_version INTEGER,
    sequence INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, entity_type, entity_id)
);

-- A local workspace uses string ids such as `shift-food-1`; the hosted
-- authority uses UUIDs. Publishing maps one to the other once and keeps the
-- mapping for retries.
CREATE TABLE sync_id_map (
    organization_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    local_id TEXT NOT NULL,
    remote_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, entity_type, local_id),
    UNIQUE (organization_id, entity_type, remote_id)
);

ALTER TABLE sync_state ADD COLUMN organization_id TEXT;
ALTER TABLE sync_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_state ADD COLUMN membership_epoch INTEGER NOT NULL DEFAULT 0;

-- The existing outbox was shaped for a table-per-mutation design. The command
-- envelope is the durable unit, so these columns carry it without rewriting
-- rows that a previous build may have queued.
ALTER TABLE sync_outbox ADD COLUMN organization_id TEXT;
ALTER TABLE sync_outbox ADD COLUMN user_id TEXT;
ALTER TABLE sync_outbox ADD COLUMN command TEXT;
ALTER TABLE sync_outbox ADD COLUMN envelope TEXT;
ALTER TABLE sync_outbox ADD COLUMN sequence_number INTEGER;
ALTER TABLE sync_outbox ADD COLUMN base_revision INTEGER;
ALTER TABLE sync_outbox ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_outbox ADD COLUMN sending_at INTEGER;
ALTER TABLE sync_outbox ADD COLUMN result TEXT;
ALTER TABLE sync_outbox ADD COLUMN updated_at TEXT;

CREATE INDEX sync_outbox_owner
    ON sync_outbox(user_id, organization_id, state, sequence_number);

CREATE UNIQUE INDEX sync_outbox_replica_sequence
    ON sync_outbox(organization_id, sequence_number)
    WHERE sequence_number IS NOT NULL;

ALTER TABLE sync_conflicts ADD COLUMN operation_id TEXT;
ALTER TABLE sync_conflicts ADD COLUMN command TEXT;
ALTER TABLE sync_conflicts ADD COLUMN classification TEXT
    CHECK (classification IS NULL OR classification IN ('field', 'invariant', 'append'));
