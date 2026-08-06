# First database backup on Windows

This procedure creates the project's custom logical backup with PostgreSQL's native tools. It does not require Docker, the Supabase CLI, or Supabase's paid backup feature.

## 1. Install PostgreSQL 17 tools

The connected database runs PostgreSQL 17.6. Download a PostgreSQL 17 Windows installer from the [official PostgreSQL download page](https://www.postgresql.org/download/windows/) and ensure **Command Line Tools** are selected during setup.

Open a new PowerShell window and verify both commands:

```powershell
pg_dump --version
psql --version
```

Both should report version 17 or newer. If Windows cannot find them, add this directory to `PATH` for the current PowerShell session:

```powershell
$env:Path += ';C:\Program Files\PostgreSQL\17\bin'
```

## 2. Copy the database connection URI

1. Open Supabase project `cswkotivlmtaegaiyxdm`.
2. Select **Connect**.
3. Choose the **Session pooler** connection.
4. Copy its URI and replace the password placeholder with the database password.

Use the session-pooler port shown by Supabase, normally `5432`. Do not use the transaction-pooler URI.

The result resembles:

```text
postgresql://postgres.cswkotivlmtaegaiyxdm:ENCODED_PASSWORD@POOLER_HOST:5432/postgres
```

URL-encode special password characters. For example, `@` becomes `%40`, `#` becomes `%23`, `/` becomes `%2F`, and `:` becomes `%3A`.

## 3. Set the connection for this PowerShell window

From the project directory, use single quotes so PowerShell does not interpret characters in the URI:

```powershell
$env:ATTENDANCE_BACKUP_DB_URL = 'postgresql://postgres.cswkotivlmtaegaiyxdm:ENCODED_PASSWORD@POOLER_HOST:5432/postgres'
```

Do not save the completed URI in the repository, `package.json`, a script, or a command file.

## 4. Run the first backup

```powershell
npm.cmd run backup:db
```

A successful run prints these stages:

```text
exporting public application schema
exporting public application data
Backup verified
Backup completed and verified
```

The completed file is created under `backups` with a UTC timestamp:

```text
backups\attendance-YYYYMMDDTHHMMSSZ.zip
```

The archive contains:

- `schema.sql`
- `data.sql`
- `backup-manifest.json`

The manifest records file sizes, SHA-256 hashes, the source project, creation time, and `pg_dump` version.

## 5. Verify the archive again

List the generated filename:

```powershell
Get-ChildItem .\backups\attendance-*.zip | Sort-Object LastWriteTime -Descending
```

Then verify the newest archive, replacing the example filename:

```powershell
npm.cmd run backup:verify -- -ArchivePath '.\backups\attendance-YYYYMMDDTHHMMSSZ.zip'
```

Do not accept a backup unless the command prints `Backup verified` and exits without an error.

## 6. Copy it off the computer

Copy the verified ZIP to encrypted storage controlled by a different account or device. Keep at least 30 daily copies. A ZIP that exists only on this computer is not disaster recovery.

## 7. Remove the temporary credential

```powershell
Remove-Item Env:ATTENDANCE_BACKUP_DB_URL
```

Close the PowerShell window after confirming the off-site copy.

## Backup scope

The archive protects the application's `public` schema and its data, including students, attendance, device logs, SMS records, reports, announcements, and audit tables. It does not contain Supabase Auth users or password hashes, actual Storage files, Edge Function secrets, API keys, or database-global platform roles.

Use `docs/DISASTER_RECOVERY.md` for restoration and recovery drills.
