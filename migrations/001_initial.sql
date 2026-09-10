CREATE TABLE users (
  id uuid PRIMARY KEY,
  username varchar(64) NOT NULL UNIQUE CHECK (username = lower(username)),
  name varchar(100) NOT NULL,
  password_hash text NOT NULL,
  role varchar(10) NOT NULL CHECK (role IN ('ADMIN', 'STAFF')),
  enabled boolean NOT NULL DEFAULT true,
  auth_version integer NOT NULL DEFAULT 1,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE submissions (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  email varchar(254) NOT NULL,
  identity varchar(50) NOT NULL,
  folder_url text NOT NULL,
  notes text NOT NULL DEFAULT '',
  status varchar(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  import_status varchar(10) NOT NULL DEFAULT 'NOT_READY' CHECK (import_status IN ('NOT_READY', 'PENDING', 'IMPORTED')),
  reviewed_by varchar(64),
  reviewed_at timestamptz,
  review_note text NOT NULL DEFAULT '',
  imported_by varchar(64),
  imported_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'APPROVED' AND import_status IN ('PENDING', 'IMPORTED')) OR (status <> 'APPROVED' AND import_status = 'NOT_READY'))
);
CREATE INDEX submissions_status_date_idx ON submissions(status, submitted_at DESC);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  submission_id uuid REFERENCES submissions(id),
  user_id uuid REFERENCES users(id),
  actor varchar(100) NOT NULL,
  action varchar(30) NOT NULL,
  note text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_submission_idx ON audit_events(submission_id, created_at);
CREATE TABLE session (
  sid varchar PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX session_expire_idx ON session(expire);
