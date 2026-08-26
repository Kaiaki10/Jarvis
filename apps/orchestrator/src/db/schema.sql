-- An agent is the identity a run belongs to: its persona, working directory, and
-- the chat thread that continues across days. Before v2 all of this lived in
-- single `settings` rows, which is why there could only ever be one Jarvis.
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  -- Appended to the system prompt. Replaces settings.business_context.
  system_prompt TEXT NOT NULL DEFAULT '',
  -- Replaces settings.chat_working_directory.
  cwd TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT 'A',
  color TEXT NOT NULL DEFAULT 'accent',
  permission_mode TEXT NOT NULL DEFAULT 'default',
  allowed_tools TEXT,
  -- Replaces settings.primary_session_id: one ongoing conversation per agent.
  chat_session_id TEXT,
  -- The simple form keeps a separate continuous thread for Codex.
  codex_chat_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status, name);

-- A room where two or more agents talk to each other.
--
-- The caps are columns, not constants: two agents talking is an infinite
-- generator running unattended, and a room must carry its own limits so a
-- change of default can never silently unbound a room already in flight.
CREATE TABLE IF NOT EXISTS agent_conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  -- idle | running | completed | stopped | error
  status TEXT NOT NULL DEFAULT 'idle',
  turn_cap INTEGER NOT NULL DEFAULT 12,
  budget_seconds INTEGER NOT NULL DEFAULT 900,
  turns_used INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  ended_at TEXT,
  -- Why it stopped, in words, so a finished room explains itself.
  stop_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Each participant keeps its own session, so it speaks with its own persona,
-- memory, and tools rather than as a voice in someone else's context.
CREATE TABLE IF NOT EXISTS agent_conversation_participants (
  conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, agent_id)
);

-- The authoritative room transcript. speaker_agent_id NULL means the human.
CREATE TABLE IF NOT EXISTS agent_conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  turn INTEGER NOT NULL,
  speaker_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  speaker_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_conversation_messages_room
  ON agent_conversation_messages(conversation_id, turn ASC);
CREATE INDEX IF NOT EXISTS idx_agent_conversations_status
  ON agent_conversations(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  claude_session_id TEXT,
  codex_thread_id TEXT,
  model TEXT NOT NULL DEFAULT 'claude',
  claude_model TEXT NOT NULL DEFAULT 'default',
  auto_approve_local_tools INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  cwd TEXT NOT NULL,
  permission_mode TEXT NOT NULL,
  allowed_tools TEXT,
  task_id TEXT,
  cost_usd REAL,
  turns INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_events_session_seq
  ON session_events(session_id, seq);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  session_id TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_created
  ON notifications(created_at DESC);

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  -- Per-account daily action cap. NULL means fall back to the global default
  -- in settings, so an account that has never been tuned still has a limit.
  daily_action_cap INTEGER,
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  label TEXT,
  platform_id TEXT NOT NULL,
  credentials TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  error_message TEXT,
  last_tested_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Where a platform account-creation attempt stands. One row per platform,
-- since signup is normally a whole-install action rather than per-persona.
-- Persisted rather than kept in React state -- a real signup can sit waiting
-- on a confirmation email for minutes to hours. See PlatformSignupProgress
-- in packages/shared/src/types.ts.
CREATE TABLE IF NOT EXISTS platform_signup_progress (
  platform_id TEXT PRIMARY KEY,
  current_step INTEGER NOT NULL DEFAULT 0,
  signup_email TEXT,
  -- Off by default. See PlatformSignupProgress.autoFollow: an explicit
  -- per-attempt operator choice, not a platform-wide default.
  auto_follow INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A confirmation email Jarvis detected for a signup in progress. Its own
-- table, not customer_messages -- a signup confirmation isn't a customer
-- conversation and shouldn't share that schema or surface in that UI.
CREATE TABLE IF NOT EXISTS signup_email_events (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  received_at TEXT NOT NULL,
  matched_link TEXT,
  -- surfaced | auto_followed
  action TEXT NOT NULL,
  event_id TEXT NOT NULL
);

-- Composite, not just event_id: the same inbound delivery can legitimately
-- claim two rows if two platforms are both waiting on the same address at
-- once (see signupInbox.ts's findProgressBySignupEmail).
CREATE UNIQUE INDEX IF NOT EXISTS idx_signup_email_events_dedupe ON signup_email_events(platform_id, event_id);
CREATE INDEX IF NOT EXISTS idx_signup_email_events_platform ON signup_email_events(platform_id, received_at DESC);

-- A Stripe Issuing virtual card, one per biller (Anthropic Console, Google
-- Ads, ...). Deliberately thin: the PAN and CVC never touch this database or
-- this process at all -- Stripe's own Issuing Elements reveal them directly
-- in the browser via a short-lived ephemeral key (billing/stripeFunding.ts).
-- Only non-sensitive identifiers live here, same as connections.field_hints
-- masks credentials rather than storing them decrypted.
CREATE TABLE IF NOT EXISTS stripe_cards (
  card_id TEXT PRIMARY KEY,
  purpose_label TEXT NOT NULL,
  -- What capacity this card authorises. Stripe enforces it at swipe time; this
  -- copy is what lets Jarvis check its own envelope before issuing another.
  monthly_limit_minor INTEGER,
  brand TEXT NOT NULL,
  last4 TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- A spend Jarvis executed against an operator-granted Coinbase Spend
-- Permission (billing/walletFunding.ts). The permission's own on-chain
-- allowance is the real enforcement; this table is the local audit trail —
-- same role platform_actions plays for social/ads actions.
CREATE TABLE IF NOT EXISTS wallet_spends (
  id TEXT PRIMARY KEY,
  purpose_label TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  token TEXT NOT NULL,
  tx_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wallet_spends_created ON wallet_spends(created_at DESC);

-- Slack conversations stay attached to the same Jarvis agent across restarts.
-- The Slack message body is deliberately not stored here; the canonical
-- transcript remains the encrypted/local Jarvis session history.
CREATE TABLE IF NOT EXISTS slack_agent_threads (
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  external_thread_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, channel_id, external_thread_id)
);

CREATE INDEX IF NOT EXISTS idx_slack_agent_threads_agent
  ON slack_agent_threads(agent_id, updated_at DESC);

-- Socket Mode may redeliver an envelope after reconnect. Claiming Slack's
-- event_id before work begins makes every inbound turn exactly-once locally.
CREATE TABLE IF NOT EXISTS slack_inbound_events (
  workspace_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_slack_inbound_events_created
  ON slack_inbound_events(created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  cwd TEXT NOT NULL,
  permission_mode TEXT NOT NULL,
  allowed_tools TEXT,
  time_of_day TEXT NOT NULL,
  days_of_week TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_session_id TEXT,
  next_run_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  position REAL NOT NULL,
  session_id TEXT,
  mission_id TEXT REFERENCES missions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  outcome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  target_date TEXT,
  next_action TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  uri TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mission_updates (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  summary TEXT NOT NULL,
  proposed_next_action TEXT,
  blocker TEXT,
  artifact_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_deliverables_mission ON deliverables(mission_id);
CREATE INDEX IF NOT EXISTS idx_mission_updates_mission ON mission_updates(mission_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evolution_proposals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  problem TEXT NOT NULL,
  expected_value TEXT NOT NULL,
  change_class TEXT NOT NULL,
  risk TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'observed',
  evidence TEXT,
  rollback_plan TEXT,
  lab_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  promoted_at TEXT
);

CREATE TABLE IF NOT EXISTS evolution_policies (
  change_class TEXT PRIMARY KEY,
  autonomy TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evolution_proposals_stage ON evolution_proposals(stage, updated_at DESC);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  audience TEXT NOT NULL,
  offer TEXT NOT NULL,
  channels TEXT NOT NULL,
  primary_metric TEXT NOT NULL,
  approval_policy TEXT NOT NULL DEFAULT 'each_item',
  status TEXT NOT NULL DEFAULT 'draft',
  -- How far five-stage onboarding has got. Resumable by design.
  onboarding_stage INTEGER NOT NULL DEFAULT 0,
  -- Off by default. When on, approved content is scheduled on a cadence
  -- without a human picking each time. Publishing still hits the approval
  -- gate -- this automates timing, not consent.
  autopilot INTEGER NOT NULL DEFAULT 0,
  autopilot_interval_hours INTEGER NOT NULL DEFAULT 24,
  mission_id TEXT REFERENCES missions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS content_items (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  format TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_for TEXT,
  published_at TEXT,
  performance_summary TEXT,
  -- Which version of the workflow's character wrote this. Null when none was
  -- set. Stage 5 needs it to tell a voice change from a topic change.
  character_version INTEGER,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_generation_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  requested_count INTEGER NOT NULL,
  -- Captured when the run starts, not when it reconciles: editing the sheet
  -- mid-run must not relabel text the previous version produced.
  character_version INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS content_publication_runs (
  id TEXT PRIMARY KEY,
  external_post_id TEXT,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  platform_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_items_workflow ON content_items(workflow_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_generation_session ON workflow_generation_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_content_publication_session ON content_publication_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_content_publication_item ON content_publication_runs(content_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS paid_growth_campaigns (
  id TEXT PRIMARY KEY,
  -- Stage 4: which workflow this ad spend belongs to.
  workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  platform TEXT NOT NULL,
  external_campaign_id TEXT,
  external_budget_entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  currency TEXT NOT NULL DEFAULT 'USD',
  daily_budget_minor INTEGER NOT NULL,
  lifetime_budget_minor INTEGER NOT NULL,
  approved_budget_minor INTEGER NOT NULL DEFAULT 0,
  spent_minor INTEGER NOT NULL DEFAULT 0,
  revenue_minor INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  target_roas REAL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paid_growth_decisions (
  id TEXT PRIMARY KEY,
  paid_campaign_id TEXT NOT NULL REFERENCES paid_growth_campaigns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  reason TEXT NOT NULL,
  proposed_daily_budget_minor INTEGER,
  source_paid_campaign_id TEXT REFERENCES paid_growth_campaigns(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_paid_growth_status ON paid_growth_campaigns(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_paid_growth_decisions_status ON paid_growth_decisions(status, created_at DESC);

-- GAPS.md attribution gap, paid-only slice: an append-only fact log, one row
-- per observation exactly like social_metrics below -- never overwritten, so
-- a time series survives even though paid_growth_campaigns itself only keeps
-- current cumulative totals. `source` is 'paid_ads' today; the shape accepts
-- 'organic' | 'lead' later without a migration, but nothing writes those yet
-- -- organic is blocked on X API credits and there is no revenue signal to
-- attribute a lead to (see BUSINESS_CONTEXT.md: zero customers, zero revenue).
CREATE TABLE IF NOT EXISTS measurement_facts (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  paid_campaign_id TEXT REFERENCES paid_growth_campaigns(id) ON DELETE CASCADE,
  -- Denormalized from the campaign at write time so organic/lead facts (which
  -- will have no paid_campaign_id) can still join on the one column every
  -- source shares, without a future migration.
  workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
  metric TEXT NOT NULL, -- spent_minor | revenue_minor | impressions | clicks | conversions
  value REAL NOT NULL,
  currency TEXT,
  captured_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_measurement_facts_campaign
  ON measurement_facts(paid_campaign_id, metric, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_measurement_facts_workflow
  ON measurement_facts(workflow_id, metric, captured_at DESC);

-- A deliberately declared comparison, not an ad-hoc ranking. Concluding one is
-- the only thing allowed to justify a reallocate decision now -- engine.ts no
-- longer compares unrelated active campaigns globally.
CREATE TABLE IF NOT EXISTS campaign_experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running', -- running | concluded | abandoned
  min_conversions_per_variant INTEGER NOT NULL DEFAULT 5,
  min_days_running INTEGER NOT NULL DEFAULT 7,
  started_at TEXT NOT NULL,
  concluded_at TEXT,
  winner_paid_campaign_id TEXT REFERENCES paid_growth_campaigns(id) ON DELETE SET NULL,
  conclusion_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- No agent_id of its own -- reached through its variants, same rule as
-- paid_growth_decisions (V2_PLAN.md: only root tables carry agent_id).
CREATE TABLE IF NOT EXISTS campaign_experiment_variants (
  experiment_id TEXT NOT NULL REFERENCES campaign_experiments(id) ON DELETE CASCADE,
  paid_campaign_id TEXT NOT NULL REFERENCES paid_growth_campaigns(id) ON DELETE CASCADE,
  is_control INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (experiment_id, paid_campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_experiments_status
  ON campaign_experiments(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_experiment_variants_campaign
  ON campaign_experiment_variants(paid_campaign_id);

CREATE TABLE IF NOT EXISTS platform_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  session_id TEXT,
  -- The platform's own id for what was posted. Without it a published post
  -- can never be looked up again, so it can never be measured.
  external_post_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_platform_actions_lookup
  ON platform_actions(platform_id, created_at);

-- agent_id NULL means the shared pool every agent reads.
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  normalized_content TEXT NOT NULL,
  source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_memories_active_updated
  ON memories(status, updated_at DESC);

-- The uniqueness indexes live in db.ts, not here: this file runs before the
-- migrations, and on a pre-v2 database `memories` has no agent_id column yet.

CREATE TABLE IF NOT EXISTS memory_reflections (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  memories_added INTEGER NOT NULL DEFAULT 0,
  memories_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_reflections_created
  ON memory_reflections(created_at DESC);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  company TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_conversations (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  sentiment TEXT NOT NULL DEFAULT 'neutral',
  assigned_to TEXT NOT NULL DEFAULT 'jarvis',
  summary TEXT,
  unread_count INTEGER NOT NULL DEFAULT 1,
  last_message_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES customer_conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  sender TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_reply_drafts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES customer_conversations(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  body TEXT,
  error_message TEXT,
  confidence REAL,
  requires_approval INTEGER NOT NULL DEFAULT 1,
  escalation_reason TEXT,
  auto_send INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_conversations_queue
  ON customer_conversations(status, priority, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_messages_conversation
  ON customer_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_customer_drafts_conversation
  ON customer_reply_drafts(conversation_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_drafts_session
  ON customer_reply_drafts(session_id);

CREATE TABLE IF NOT EXISTS customer_channel_threads (
  provider TEXT NOT NULL,
  external_thread_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES customer_conversations(id) ON DELETE CASCADE,
  access_token_hash TEXT,
  reply_to TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, external_thread_id)
);

CREATE TABLE IF NOT EXISTS customer_inbound_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE IF NOT EXISTS customer_message_deliveries (
  message_id TEXT PRIMARY KEY REFERENCES customer_messages(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  external_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The human who owns this Jarvis install. Exactly one exists in the common
-- case; a second passkey (a phone, a backup key) adds a credential to the
-- same operator rather than creating a second one — this table gives login a
-- real identity to attach to without pretending Jarvis is multi-tenant.
CREATE TABLE IF NOT EXISTS operators (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- A registered passkey. credential_id is the id WebAuthn itself assigns and
-- is already globally unique, so it is the primary key rather than a
-- generated one. public_key is the base64url-encoded COSE key SimpleWebAuthn
-- returns; counter guards against a cloned authenticator being replayed.
CREATE TABLE IF NOT EXISTS operator_credentials (
  credential_id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  device_label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_operator_credentials_operator
  ON operator_credentials(operator_id);

-- Empty until a second identity provider (e.g. Sign in with ChatGPT) ships.
-- Its own table, not a column on operators, so a provider attaches to an
-- existing operator instead of forcing a schema rewrite when it arrives.
CREATE TABLE IF NOT EXISTS operator_identities (
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  PRIMARY KEY (provider, provider_subject)
);

-- DB-backed so a session survives an orchestrator restart, matching the rest
-- of this project's bias toward durable over in-memory state.
CREATE TABLE IF NOT EXISTS operator_sessions (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_operator_sessions_operator
  ON operator_sessions(operator_id, expires_at DESC);

-- A short-lived credential scoped to exactly one agent, minted by the Next.js
-- dashboard (apps/web/src/app/api/token/route.ts) through POST /agent-tokens
-- once it has confirmed the caller's operator session. Mirrors operator_sessions:
-- the token itself is the primary key (plaintext, unguessable, no hashing), and
-- security comes from length + a short expires_at rather than a lookup secret.
-- operator_id is nullable because JARVIS_REQUIRE_LOGIN=0 installs mint tokens
-- with no operator identity to attach at all.
CREATE TABLE IF NOT EXISTS agent_tokens (
  token TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  operator_id TEXT REFERENCES operators(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_tokens_agent
  ON agent_tokens(agent_id, expires_at DESC);

-- A pending WebAuthn ceremony's challenge, bridging the options/verify round
-- trip. Short-lived by construction: verify deletes its row on success or
-- failure, and a fresh ceremony sweeps expired rows rather than needing a
-- scheduled job for what is, worst case, a handful of abandoned rows.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  challenge TEXT NOT NULL,
  operator_id TEXT REFERENCES operators(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_service_policy (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  auto_reply_website INTEGER NOT NULL DEFAULT 1,
  auto_reply_email INTEGER NOT NULL DEFAULT 0,
  auto_reply_social INTEGER NOT NULL DEFAULT 0,
  confidence_threshold REAL NOT NULL DEFAULT 0.9,
  max_auto_replies INTEGER NOT NULL DEFAULT 3,
  business_hours_start TEXT NOT NULL DEFAULT '08:00',
  business_hours_end TEXT NOT NULL DEFAULT '18:00',
  business_days TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
  escalation_keywords TEXT NOT NULL DEFAULT '["refund","chargeback","legal","lawsuit","threat","fraud","cancel"]',
  widget_name TEXT NOT NULL DEFAULT 'Jarvis Support',
  widget_welcome TEXT NOT NULL DEFAULT 'Hi — how can we help?',
  allowed_origins TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

-- Stage 1: the accounts a workflow may act as. A workflow legitimately has
-- several (an X account and an email sender), which one pin column could not
-- express. A publication session is handed only these, so content cannot reach
-- an account its workflow does not list.
CREATE TABLE IF NOT EXISTS workflow_accounts (
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workflow_id, connection_id)
);

-- Stage 3: one row per observation rather than per post, so performance has a
-- history instead of a last-known value overwritten in place.
CREATE TABLE IF NOT EXISTS social_metrics (
  id TEXT PRIMARY KEY,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  platform_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  captured_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_social_metrics_item ON social_metrics(content_item_id, metric, captured_at DESC);

-- Stage 5: what the workflow appears to have learned, in words, with the
-- evidence it came from. Deliberately carries no revenue column -- the system
-- has no revenue signal, and a column invites someone to fill it with a guess.
CREATE TABLE IF NOT EXISTS workflow_insights (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  statement TEXT NOT NULL,
  evidence TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'low',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_insights_workflow ON workflow_insights(workflow_id, created_at DESC);

-- The voice a workflow speaks in (see CHARACTER_PLAN.md).
--
-- `exemplars` carries sample posts rather than adjectives: current models match
-- a voice far better from a writing sample than from a description of one, so
-- it is the highest-value field here. `disclosure` is NOT NULL by construction —
-- presenting an AI persona as a real person without disclosure is deceptive
-- under FTC Section 5, so it cannot be an optional field someone forgets.
CREATE TABLE IF NOT EXISTS workflow_characters (
  workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  persona TEXT NOT NULL DEFAULT '',
  voice_rules TEXT NOT NULL DEFAULT '',
  -- JSON array of sample posts.
  exemplars TEXT NOT NULL DEFAULT '[]',
  appearance TEXT NOT NULL DEFAULT '',
  -- JSON array of locked turnaround reference image ids. Empty until image
  -- generation exists.
  reference_image_ids TEXT NOT NULL DEFAULT '[]',
  disclosure TEXT NOT NULL,
  -- Bumped whenever the voice materially changes. Content records the version
  -- that wrote it, so stage 5 can separate a voice change from a topic change.
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Every past version of a character. The live row only holds the current
-- sheet, so without this "v3 outperformed v4" would be observable but not
-- answerable -- you could see the number change and never see what changed.
CREATE TABLE IF NOT EXISTS workflow_character_versions (
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  persona TEXT NOT NULL,
  voice_rules TEXT NOT NULL,
  exemplars TEXT NOT NULL,
  appearance TEXT NOT NULL,
  disclosure TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workflow_id, version)
);

-- A money limit on one rail (see UNDER_THE_HOOD_PLAN.md).
--
-- Denominated in money rather than actions: the existing daily cap counts
-- calls, so twenty cheap posts and twenty expensive ad buys look identical to
-- it. That cap stays as the runaway-loop guard; this bounds spend.
--
-- `currency` is part of the envelope and is never converted. A wallet spend in
-- USDC minor units and a card charge in USD cents are different numbers, and
-- comparing them would silently authorise the wrong amount. A mismatch is
-- refused, not guessed -- there are no FX rates in this system.
CREATE TABLE IF NOT EXISTS spend_envelopes (
  id TEXT PRIMARY KEY,
  -- Null applies to every agent, the same private-plus-shared shape as memories.
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  -- wallet | card | ad_budget
  rail TEXT NOT NULL,
  -- day | month
  period TEXT NOT NULL,
  limit_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_spend_envelopes_scope
  ON spend_envelopes(rail, period, currency, IFNULL(agent_id, ''));

-- Every spend, whatever rail it moved over, so "what has Jarvis spent this
-- month" is one query rather than three joins across two providers.
CREATE TABLE IF NOT EXISTS spend_ledger (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  rail TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  -- What it was for, in words, so the ledger is readable without joins.
  reason TEXT NOT NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  -- The provider's own reference, when there is one (tx hash, charge id).
  external_ref TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spend_ledger_rail_created
  ON spend_ledger(rail, created_at DESC);
