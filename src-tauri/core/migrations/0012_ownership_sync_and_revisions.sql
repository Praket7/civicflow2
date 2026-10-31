-- Organizations gain an owner, membership epochs, and a sync identity. The
-- epoch is the defence against a device that was offline while access changed:
-- a privileged mutation records the epoch it was created under, and the
-- authority refuses it once the membership has moved on.

ALTER TABLE organizations ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN sync_mode TEXT NOT NULL DEFAULT 'local'
    CHECK (sync_mode IN ('local', 'synced'));
ALTER TABLE organizations ADD COLUMN remote_id TEXT;
ALTER TABLE organizations ADD COLUMN replica_id TEXT;
ALTER TABLE organizations ADD COLUMN synced_at TEXT;

UPDATE organizations
SET is_demo = 1
WHERE id = 'org-rivergate-kitchen';

-- SQLite cannot widen a CHECK constraint in place, so the membership table is
-- rebuilt. The rebuild also gives every row an epoch.
ALTER TABLE organization_memberships RENAME TO organization_memberships_v11;
DROP INDEX IF EXISTS organization_memberships_user;

CREATE TABLE organization_memberships (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'coordinator', 'volunteer')),
    status TEXT NOT NULL CHECK (status IN ('active', 'invited', 'disabled')),
    joined_at TEXT NOT NULL,
    membership_epoch INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (organization_id, user_id)
);

INSERT INTO organization_memberships
    (organization_id, user_id, role, status, joined_at, membership_epoch)
SELECT organization_id, user_id, role, status, joined_at, 1
FROM organization_memberships_v11;

DROP TABLE organization_memberships_v11;
CREATE INDEX organization_memberships_user ON organization_memberships(user_id, status);

-- Every organization keeps one active owner. The earliest coordinator is the
-- natural first owner; an organization whose coordinator rows were all removed
-- promotes its earliest remaining member so it is never ownerless.
UPDATE organization_memberships
SET role = 'owner'
WHERE rowid IN (
    SELECT MIN(rowid) FROM organization_memberships
    WHERE role = 'coordinator' AND status = 'active'
    GROUP BY organization_id
);

UPDATE organization_memberships
SET role = 'owner'
WHERE rowid IN (
    SELECT MIN(m.rowid) FROM organization_memberships m
    WHERE m.status = 'active'
      AND NOT EXISTS (
          SELECT 1 FROM organization_memberships o
          WHERE o.organization_id = m.organization_id
            AND o.role = 'owner'
            AND o.status = 'active'
      )
    GROUP BY m.organization_id
);

CREATE TRIGGER organization_memberships_keep_owner_on_update
BEFORE UPDATE OF role, status ON organization_memberships
WHEN OLD.role = 'owner'
 AND (NEW.role <> 'owner' OR NEW.status <> 'active')
 AND NOT EXISTS (
     SELECT 1 FROM organization_memberships
     WHERE organization_id = OLD.organization_id
       AND user_id <> OLD.user_id
       AND role = 'owner'
       AND status = 'active'
 )
BEGIN
    SELECT RAISE(ABORT, 'an organization must keep an active owner');
END;

CREATE TRIGGER organization_memberships_keep_owner_on_delete
BEFORE DELETE ON organization_memberships
WHEN OLD.role = 'owner' AND OLD.status = 'active'
 AND NOT EXISTS (
     SELECT 1 FROM organization_memberships
     WHERE organization_id = OLD.organization_id
       AND user_id <> OLD.user_id
       AND role = 'owner'
       AND status = 'active'
 )
BEGIN
    SELECT RAISE(ABORT, 'an organization must keep an active owner');
END;

-- Invitations are addressed to an email address and can be revoked before
-- redemption. A coordinator code that anyone could reuse is no longer stored.
ALTER TABLE organization_invites ADD COLUMN email TEXT;
ALTER TABLE organization_invites ADD COLUMN revoked_at TEXT;

CREATE INDEX organization_invites_created
    ON organization_invites(organization_id, created_at);

-- Row versions make an integrity-sensitive update comparable across replicas.
-- They are local defaults; the cloud authority owns the authoritative sequence.
ALTER TABLE organizations ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE organization_memberships ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE volunteers ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE opportunities ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE shifts ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE registrations ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE waitlist_entries ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hour_entries ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE attendance_events ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE volunteer_credentials ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE organization_roster_policies ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;

CREATE TRIGGER volunteers_row_version AFTER UPDATE ON volunteers
BEGIN UPDATE volunteers SET row_version = OLD.row_version + 1 WHERE rowid = NEW.rowid; END;
CREATE TRIGGER opportunities_row_version AFTER UPDATE ON opportunities
BEGIN UPDATE opportunities SET row_version = OLD.row_version + 1 WHERE rowid = NEW.rowid; END;
CREATE TRIGGER shifts_row_version AFTER UPDATE ON shifts
BEGIN UPDATE shifts SET row_version = OLD.row_version + 1 WHERE rowid = NEW.rowid; END;
CREATE TRIGGER waitlist_row_version AFTER UPDATE ON waitlist_entries
BEGIN UPDATE waitlist_entries SET row_version = OLD.row_version + 1 WHERE rowid = NEW.rowid; END;
CREATE TRIGGER hours_row_version AFTER UPDATE ON hour_entries
BEGIN UPDATE hour_entries SET row_version = OLD.row_version + 1 WHERE rowid = NEW.rowid; END;
CREATE TRIGGER attendance_row_version AFTER UPDATE ON attendance_events
BEGIN UPDATE attendance_events SET row_version = OLD.row_version + 1 WHERE rowid = NEW.rowid; END;
CREATE TRIGGER credentials_row_version AFTER UPDATE ON volunteer_credentials
BEGIN UPDATE volunteer_credentials SET row_version = OLD.row_version + 1 WHERE rowid = NEW.rowid; END;
CREATE TRIGGER memberships_row_version AFTER UPDATE ON organization_memberships
BEGIN UPDATE organization_memberships SET row_version = OLD.row_version + 1 WHERE rowid = NEW.rowid; END;

-- One revision counter for the whole workspace. AutoRoster plans record it and
-- refuse to apply once it has moved, which is cheaper and safer than a version
-- per assignment.
CREATE TABLE workspace_revision (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);

INSERT INTO workspace_revision (id, revision, updated_at)
VALUES (1, 1, strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'));

CREATE TRIGGER revision_after_registration_insert AFTER INSERT ON registrations
BEGIN UPDATE workspace_revision SET revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id = 1; END;
CREATE TRIGGER revision_after_registration_delete AFTER DELETE ON registrations
BEGIN UPDATE workspace_revision SET revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id = 1; END;

CREATE TRIGGER revision_after_shift_update AFTER UPDATE ON shifts
BEGIN UPDATE workspace_revision SET revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id = 1; END;
CREATE TRIGGER revision_after_shift_delete AFTER DELETE ON shifts
BEGIN UPDATE workspace_revision SET revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id = 1; END;

CREATE TRIGGER revision_after_shift_role_insert AFTER INSERT ON shift_roles
BEGIN UPDATE workspace_revision SET revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id = 1; END;
CREATE TRIGGER revision_after_shift_role_update AFTER UPDATE ON shift_roles
BEGIN UPDATE workspace_revision SET revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id = 1; END;
CREATE TRIGGER revision_after_shift_role_delete AFTER DELETE ON shift_roles
BEGIN UPDATE workspace_revision SET revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id = 1; END;

CREATE TRIGGER revision_after_credential_change AFTER INSERT ON volunteer_credentials
BEGIN UPDATE workspace_revision SET revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id = 1; END;
CREATE TRIGGER revision_after_credential_update AFTER UPDATE ON volunteer_credentials
BEGIN UPDATE workspace_revision SET revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id = 1; END;
CREATE TRIGGER revision_after_credential_delete AFTER DELETE ON volunteer_credentials
BEGIN UPDATE workspace_revision SET revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id = 1; END;

CREATE TRIGGER revision_after_registration_update AFTER UPDATE ON registrations
BEGIN UPDATE workspace_revision SET revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id = 1; END;

CREATE TRIGGER revision_after_waitlist_insert AFTER INSERT ON waitlist_entries
BEGIN UPDATE workspace_revision SET revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id = 1; END;
CREATE TRIGGER revision_after_waitlist_update AFTER UPDATE ON waitlist_entries
BEGIN UPDATE workspace_revision SET revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id = 1; END;
CREATE TRIGGER revision_after_waitlist_delete AFTER DELETE ON waitlist_entries
BEGIN UPDATE workspace_revision SET revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id = 1; END;

-- A durable outbox. Every mutation that a synced workspace captures is written
-- in the same SQLite transaction as the change it describes, so a crash cannot
-- leave a change without its upload record.
CREATE TABLE sync_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL UNIQUE,
    entity_table TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
    payload TEXT NOT NULL,
    membership_epoch INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'sending', 'conflict', 'failed', 'sent')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);

CREATE INDEX sync_outbox_pending ON sync_outbox(state, id);

CREATE TABLE sync_conflicts (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    replica_id TEXT,
    transaction_id TEXT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    code TEXT NOT NULL,
    summary TEXT NOT NULL,
    local_payload TEXT,
    authoritative_payload TEXT,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'resolved', 'dismissed')),
    created_at TEXT NOT NULL,
    resolved_at TEXT
);

CREATE INDEX sync_conflicts_open ON sync_conflicts(status, created_at);

CREATE TABLE sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mode TEXT NOT NULL DEFAULT 'local'
        CHECK (mode IN ('local', 'synced')),
    cursor TEXT,
    last_synced_at TEXT,
    last_attempt_at TEXT,
    last_error TEXT,
    pending_conflicts INTEGER NOT NULL DEFAULT 0
);

INSERT INTO sync_state (id, mode) VALUES (1, 'local');

CREATE TABLE replica_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    replica_id TEXT NOT NULL,
    device_label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

INSERT INTO replica_meta (id, replica_id, device_label, created_at, last_seen_at)
VALUES (1, lower(hex(randomblob(16))), '', strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'),
        strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'));
