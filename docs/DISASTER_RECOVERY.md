# Data backup and disaster recovery

Owner: system administrator  
Review cadence: quarterly and after every material database or infrastructure change

This runbook covers the PostgreSQL data used by Axentra@Zuanshi, including students, attendance, biometric punches, reports, announcements, and audit records. It also identifies Supabase services that require separate recovery steps.

## Recovery objectives

| Objective | Custom-backup target |
| --- | --- |
| Recovery point objective (RPO) | Last verified off-site logical export; up to 24 hours with daily scheduling |
| Recovery time objective (RTO) | 8 hours when rebuilding into a fresh project |
| Logical backup retention | 30 daily, 12 monthly, and 7 annual copies; adjust only after a documented data-retention review |
| Restore drill | Quarterly into an isolated project and after schema or authentication changes |

The RPO can be reduced by running the custom backup more frequently. The administrator must measure it from the newest verified off-site archive, not merely from the last scheduled-job start time.

## Protection layers

1. **Source-controlled application state.** Migrations, Edge Functions, and frontend code are stored in Git. Tag every production release.
2. **Custom logical export.** Run `scripts/backup-database.ps1` every day. This uses PostgreSQL's native `pg_dump` and does not use Docker, the Supabase CLI, or Supabase's paid backup service.
3. **Independent off-site copies.** Copy every verified archive to encrypted storage under a separate account with versioning or immutable retention.
4. **Separate Storage-object backup.** The logical database export does not contain actual files stored through the Storage API. If Storage is introduced, add an object-copy job before declaring the backup plan complete.

The off-site archive must use a separate account or storage provider so deletion or compromise of the application project cannot delete its recovery copies.

## One-time setup

1. Install the PostgreSQL 17 command-line tools (`pg_dump` and `psql`) from the [official Windows installer](https://www.postgresql.org/download/windows/), then add the PostgreSQL `bin` directory to `PATH`. Docker is not required. The production database currently runs PostgreSQL 17.6, and `pg_dump` must not be older than the server's major version.
2. Copy `backup.env.example` to a location outside the repository and load `ATTENDANCE_BACKUP_DB_URL` into the dedicated backup account's environment.
3. Use the **session pooler** connection string unless direct IPv6 connectivity is available. URL-encode special characters in the password.
4. Restrict access to the backup directory and the service account. Never put the database URL in Task Scheduler arguments, logs, tickets, or source control.
5. Configure encrypted off-site storage with object versioning or immutable retention.

## Create a logical backup

From the repository root in PowerShell:

```powershell
$env:ATTENDANCE_BACKUP_DB_URL = 'postgresql://...'
npm run backup:db
```

The command creates `backups/attendance-<UTC timestamp>.zip`. It exports the public application schema and data with native `pg_dump`, records SHA-256 hashes, compresses the files, and verifies the completed archive. Incomplete working files are retained for diagnosis and are never presented as successful backups.

Each archive contains `schema.sql`, `data.sql`, and `backup-manifest.json`. It intentionally does not contain database-global roles because a fresh Supabase project already owns and manages its platform roles.

Retention deletion is opt-in:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-database.ps1 -PruneExpired -RetentionDays 30
```

Do not enable pruning until the archive-copy job confirms that the new backup exists off-site. Monthly and annual retention should be implemented with immutable storage lifecycle rules, not by keeping every file on the backup workstation.

## Scheduling and monitoring

- Run the backup daily from a dedicated operating-system account with no interactive login privileges.
- Store `ATTENDANCE_BACKUP_DB_URL` in the scheduler's protected account environment or an approved secret manager. Do not embed it in the scheduled command.
- Schedule `powershell -NoProfile -ExecutionPolicy Bypass -File <repository>\scripts\backup-database.ps1` after the school's final synchronization window.
- Treat a non-zero process exit, a missing daily archive, failed checksum verification, or failed off-site copy as an alert requiring same-day action.
- Send success/failure logs to the operational monitoring system, but never log environment variables or database connection arguments.
- Run a second daily job that confirms an off-site object exists, is non-zero, and is readable from a different account. A local archive alone is not a disaster-recovery backup.
- Review the newest verified local and off-site archive timestamps every morning. Alert when either exceeds the approved RPO.

## Verify an archive

Verification is offline and never connects to a database:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-backup.ps1 -ArchivePath backups/attendance-20260806T120000Z.zip
```

The check validates the manifest, required files, lengths, and SHA-256 hashes. A checksum check proves archive integrity, not recoverability. Only a restore drill proves recoverability.

## Incident decision tree

### Accidental update, delete, or bad migration

1. Declare the incident and record the current UTC time.
2. Stop attendance sync jobs and application writes if continued writes would worsen the incident.
3. Identify the last known-good time from audit data and deployment records.
4. Create a fresh isolated recovery project and restore the newest archive created before the bad change.
5. Validate the recovery project, then cut the application over to it.
6. The custom restore script intentionally refuses to restore into the source project.

### Source project unavailable or irrecoverable

1. Check [Supabase Status](https://status.supabase.com/) and avoid conflicting recovery actions during an active provider incident.
2. Create a fresh recovery project in the required region.
3. Restore the latest known-good backup.
4. Reconfigure everything listed in the post-restore checklist.
5. Validate the recovery project before changing application traffic.

### Compromised credentials or malicious changes

1. Preserve logs and do not destroy evidence.
2. Revoke exposed API keys, database credentials, sessions, and access tokens.
3. Create a clean recovery project and restore a backup from before the compromise.
4. Review all database functions, RLS policies, users, Edge Functions, secrets, and scheduled jobs before cutover.
5. Rotate every credential again after recovery.

## Restore a logical export

Logical restore is intended for a **new, isolated Supabase project**. It is dry-run by default, does not drop existing objects, verifies the archive first, and always refuses a source-project match.

1. Create a new Supabase recovery project.
2. Enable the extensions and Database Webhooks used by the source project.
3. Install PostgreSQL `psql` and add it to `PATH`.
4. Set the recovery project's session-pooler URL:

```powershell
$env:ATTENDANCE_RESTORE_DB_URL = 'postgresql://...recovery project...'
```

5. Preview the operation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restore-database.ps1 -ArchivePath backups/attendance-20260806T120000Z.zip
```

6. Copy the exact confirmation value printed by the dry run, then execute:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restore-database.ps1 `
  -ArchivePath backups/attendance-20260806T120000Z.zip `
  -Execute `
  -Confirmation 'RESTORE recovery-project-ref'
```

The restore uses one transaction with `ON_ERROR_STOP`; a SQL failure rolls the transaction back. If Supabase reports managed-role ownership or grant errors, stop and follow the current Supabase troubleshooting guidance rather than weakening the script or skipping unknown statements.

## Post-restore checklist

- [ ] Confirm the expected migration level and database objects.
- [ ] Compare row counts for `students`, `student_enrollments`, `attendance_sessions`, `attendance_records`, `device_logs`, and correction-audit tables with the incident record or source.
- [ ] Verify the newest and oldest attendance dates and inspect several student histories.
- [ ] Confirm RLS is enabled and test both admin and student access using non-privileged accounts.
- [ ] Recreate Auth users and require secure password setup/reset. The custom logical archive protects application profiles and student links but does not contain managed Auth users or password hashes.
- [ ] Restore or re-create Storage buckets and copy actual objects separately, if Storage is in use.
- [ ] Configure Auth providers, redirect URLs, CAPTCHA, API keys, SMTP, Realtime publications, database extensions, and network restrictions.
- [ ] Deploy all Edge Functions from `supabase/functions` and restore their secrets from the secret manager.
- [ ] Confirm cron jobs, attendance synchronization, anomaly analysis, and device connectivity.
- [ ] Update the frontend's Supabase URL and public key, deploy, and run administrator and student smoke tests.
- [ ] Rotate database passwords and sensitive keys used during recovery.
- [ ] Monitor errors, authentication, attendance ingestion, and data counts during cutover.
- [ ] Record actual RPO, RTO, data loss, decisions, and follow-up actions.

## Quarterly restore drill

1. Select the newest off-site archive without copying it back from the local backup folder.
2. Verify it with `verify-backup.ps1`.
3. Restore it into a disposable isolated Supabase project.
4. Complete every applicable post-restore check and record timings.
5. Recreate representative Auth users, relink them to application profiles, and test login separately.
6. Delete the disposable project only after the drill evidence is retained and a second operator approves cleanup.
7. Update this runbook with any failed step or missing configuration.

## Scope and authoritative references

The scripts use PostgreSQL's native logical export and transactional `psql` restore tools. They do not use Docker, the Supabase CLI, the paid backup service, or the backup Management API. Review the current PostgreSQL guidance before every real incident:

- [PostgreSQL pg_dump documentation](https://www.postgresql.org/docs/17/app-pgdump.html)
- [PostgreSQL psql documentation](https://www.postgresql.org/docs/current/app-psql.html)
