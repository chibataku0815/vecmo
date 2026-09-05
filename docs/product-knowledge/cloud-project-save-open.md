# Cloud project save/open

> **Cloud-only.** This page describes the vecmo.dev hosted service. The backend is not part of this repository; in the open-source build these controls are hidden.

Status: `beta`

## What changed

Vecmo now has an account-backed cloud project path inside the editor. Signed-in
users with Creator or Creator Pro access can save the current document to their
personal workspace, manage saved cloud projects from `/projects`, and reopen one
later into the editor. Creator Pro users can also restore a past cloud revision
as a new current revision.

## What can a user do now

- Keep using `/editor` signed out. Browser-local persistence still restores the
  last local document.
- Download and restore local `.vecmo-backup.json` project backups without an
  account.
- The top-bar title area shows the document's passive continuity state: local,
  cloud saved, cloud unsaved, saving, failed, or conflict.
- Opening a current cloud project synchronizes the editor title from the cloud
  project name, so the project browser and the top-left editor title present one
  file identity. Historical revision opens remain local recovery previews and do
  not reattach the current cloud project.
- The account-adjacent Cloud control shows the primary next action for that
  state. Local documents offer **Save to cloud**; cloud-attached documents offer
  **Save now**, **Retry cloud save**, or conflict recovery.
- Opening the Cloud popover shows a compact workflow rather than a flat action
  list: cloud save access, the next cloud action, optional cloud-project status
  for attached documents, and the saved-project browser link when the account
  state can use it. Failed and conflict states switch the middle of the popover
  into a cloud recovery plan.
- The Cloud popover also shows account save access before a write is attempted:
  signed out, Creator required, unavailable, or cloud saves enabled. This is
  explanatory only; the Worker still enforces the actual save boundary. When
  save access is still checking, cloud save is temporarily disabled. When save
  access is missing, the popover does not stack a separate warning card; the
  primary cloud action itself becomes the sign-in or plan-management step and
  opens the adjacent Account panel without moving the document into a save-failed
  state. Cloud save access is refreshed on editor load and after the Account
  panel closes, not every time the Cloud popover opens.
- When signed in with Creator access, open **Cloud** in the top bar and choose
  **Save to cloud** to attach the local document to a project in the user's
  personal workspace.
- Start a blank project directly from the editor top-bar **New project** button
  or from `/projects`. New project creation stays local first; saving it to
  cloud is still an explicit follow-up action.
- Edits to an active cloud project mark the document unsaved and autosave after a
  conservative delay. `Mod+S` flushes the active cloud save immediately.
- Refreshing an active cloud project compares the restored local document to the
  last saved cloud fingerprint. If they no longer match, the title shows
  **Unsaved** rather than claiming the cloud copy is current.
- **Work locally** in the Cloud popover detaches the current editor tab from the
  cloud project without changing the document. Browser-local persistence,
  backup, and export remain available.
- Open **Projects** from the Cloud popover when account state allows it, or visit
  `/projects`, to search saved projects, open one, rename it, archive it, or
  download a backup. The page is a focused open/recovery surface, not a generic
  file manager: its compact flow separates opening a saved project, reviewing
  version history, downloading a recovery backup, and creating a new cloud copy.
  Duplicating a cloud project and importing a local backup into cloud storage
  require Creator access because they create new cloud storage.
- Expand a project's **Version history** row on `/projects` to list stored
  revisions. Each revision shows whether it is current, its timestamp, size, R2/D1
  provider, and a short content hash.
- From an active cloud project in the editor, the Cloud menu exposes a direct
  **Version history** action. It opens a right-side editor history drawer so
  revision review, open, download, and restore stay in the authoring workspace.
  When the current cloud project is already saved, this history action is the
  Cloud menu's primary action; **Save now** is reserved for unsaved, failed,
  conflicted, or local-cloud attachment states.
- The document-name chip stays focused on file identity: rename inline, show the
  current cloud/local state, and expose a direct history icon only for
  cloud-attached documents. Import and Backup remain dedicated top-bar actions,
  so the Cloud menu does not duplicate local file controls.
- `/projects?history=<projectId>` remains supported for project-browser deep
  links and opens the matching project's history row.
- The Account popover stays focused on account, subscription, renewal, and
  server-export allowance. Cloud project storage and version-history actions live
  in the Cloud menu and `/projects`, so billing status no longer reads like a dead
  end for document recovery.
- Open a historical revision from `/projects` to preview or recover it in the
  editor. Historical opens load the document as local work unless that revision
  is the current cloud revision, so autosave does not accidentally overwrite the
  active cloud project from an old base.
- Download any listed revision as the same portable `.vecmo-backup.json` format
  used by local backup.
- Restore a past revision from `/projects` when Creator Pro access is available.
  Restore is non-destructive: it writes the selected historical body as a new
  current revision and keeps old revisions available.
- Choose a saved project from `/projects` to load its scene, motion, and
  motion-grammar bindings into `/editor`.
- Opening another cloud project is guarded when the current editor has local
  work, unsaved active-cloud changes, a failed save, or a conflict. The guard is
  recovery-first: the user can save the current cloud project first, download a
  local backup, replace without saving, or keep editing. For local-only work,
  downloading a local backup is the primary safe action.
- If the cloud revision changed since the editor loaded it, the Cloud popover
  offers explicit recovery actions: save the current work as a cloud copy, open
  the latest cloud revision, download a local backup, or review saved projects.
- If the attached cloud project is no longer available in the signed-in
  workspace, the editor treats the attachment as stale instead of retrying the
  same missing project id. The document stays open locally, autosave stops
  writing to that stale id, and the Cloud popover makes **Save as new cloud
  project** the primary recovery action alongside Work locally and Projects.

## How it works

The browser serializes the current authoring state through the existing project
backup envelope: scene document, motion document, optional motion-grammar layer,
project title, and save timestamp. The Worker stores the project body in R2 and
keeps the queryable ownership/revision index in D1:

- `platform_project` stores list metadata.
- `platform_project_content` stores the active R2 object pointer, byte length,
  content hash, document version, and revision.
- `platform_project_revision` records immutable revision metadata.
- R2 stores the large `.vecmo` JSON document body under server-derived
  workspace/project/revision keys.
- List reads select metadata only; the R2 JSON payload is fetched only when
  opening or downloading one project or revision.
- Save/update routes enforce same-origin JSON mutations and reject payloads over
  the cloud document size limit.
- Storage-growing routes also enforce server-side cost safety limits before R2
  writes: 20 active cloud projects per personal workspace, 200 saved revisions
  per project, and 1 GB of cumulative cloud project revision bodies per personal
  workspace.
- Version history routes are tenant-scoped through the same authenticated
  personal workspace boundary: `GET /api/projects/:projectId/revisions`,
  `GET /api/projects/:projectId/revisions/:revision`, and
  `POST /api/projects/:projectId/revisions/:revision/restore`.
- Restore reads the selected immutable revision body from R2 and writes a new R2
  object plus D1 revision metadata before advancing the active content pointer.
  The client sends only the project id and revision path parameters plus an empty
  JSON body; it never supplies a workspace id or replacement document body.
- Every read/write resolves the authenticated user's personal workspace on the
  server through the account tenant boundary. The client never supplies a
  workspace id.
- Local development normally uses a local D1/R2 sandbox. Operators can start the
  dedicated `dev:production-cloud` mode when a local code change must save as the
  same production user; that mode connects only D1/R2 remotely, keeps
  `BETTER_AUTH_URL` on localhost, and disables local billing overrides and
  account deletion.
- MCP agents can call `save_project_live` against the running editor to persist
  the currently open scene / motion / motion-grammar document through the same
  cloud-project save path as the UI. The tool uses the live bridge, defaults to
  local relay discovery, supports `save`, `save-as-new`, and `save-as-copy`
  modes, and follows the editor-owned approval policy: local dev bridge
  requests auto-approve, while production bridge sessions write only after the
  editor approval banner is accepted. See
  [Agent Bridge Development Auto-Approval](./agent-bridge-dev-auto-approval.md)
  for the local development boundary. When an agent omits `name`, the editor
  derives a cloud-project name from the agent intent and current scene / motion
  / motion-grammar content so repeated saves do not collapse into generic titles
  such as `Untitled`.
- Cloud project storage authorization depends on the resolved account
  entitlement. The Worker resolves the authenticated user's personal workspace,
  reads the stored subscription state, and gates storage-growing mutations
  through `cloudProjectStorage`.
- Version restore is gated through the Creator Pro `cloudProjectHistory`
  entitlement because it creates a new cloud revision from stored history.
- List/read/download/archive and revision read/download remain available for
  existing projects after downgrade or payment failure so users can recover work.
- The editor namespaces its active cloud pointer and save state by Working Copy.
  Scene, motion, and motion grammar are persisted atomically as one portable
  project snapshot for that copy. Multiple tabs therefore do not overwrite one
  fixed browser slot.

## Why it matters

This is the first commercial boundary that improves workflow continuity without
charging for local ownership. The user can still edit locally, export locally,
and keep a portable backup file. Signing in adds cross-session project continuity
rather than becoming the only way to keep work.

## What is still limited

- This is parallel independent editing with one explicit cloud Writer per
  project, not live multi-tab sync or collaboration. Review editors reopen or
  fork instead of receiving live changes.
- Cloud project storage is pricing-enforced for writes. Free signed-in users can
  still use local editing, local backup, and local export; they need Creator
  access to create, update/save, duplicate, or import cloud projects, and
  Creator Pro access to restore version history into the current cloud project.
- Cloud project writes have MVP cost safety caps. Hitting a cap blocks only new
  cloud writes; existing cloud projects can still be opened or downloaded, and
  local editing, local backup, and local export remain available.
- The conflict surface is recovery-first, not a semantic merge editor.
- Archived projects are hidden from the project browser; retention and hard
  delete policy are still a later production decision.
- Backend account/auth/D1/R2 provisioning still determines whether the beta
  surface works in a deployed environment.
- Release readiness for this beta depends on the production D1 migrations, R2
  bucket, account secrets, and billing entitlements being verified against the
  deployed Worker. Those checks do not change the open local editor, local
  backup, or local export paths.
- Importing a local backup into cloud requires sign-in and cloud availability;
  restoring a local backup into the editor does not.
