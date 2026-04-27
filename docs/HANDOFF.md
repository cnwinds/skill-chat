# SkillChat Handoff

## Project Boundary

SkillChat is exposed at:

```text
C:\projects\skill-chat
```

The real working tree is still:

```text
C:\projects\qizhi
```

Do not modify:

```text
C:\projects\skill-market
C:\projects\official-skills
```

`C:\projects\skill-market\packages\skill-spec` is consumed read-only through the local SkillChat workspace package `@qizhi/skill-spec`.

## Market Install Foundation

Server config now includes:

```text
MARKET_BASE_URL=http://localhost:3100
INSTALLED_SKILLS_ROOT={DATA_ROOT}/installed-skills
```

The install model is:

```text
System-level package cache: data/installed-skills/{publisher}/{name}/{version}
User-level install state: user_installed_skills
Session-level enable state: sessions.active_skills
```

SQLite keeps the legacy `installed_skills` table for migration compatibility, but new code uses:

```text
skill_packages
user_installed_skills
```

`skill_packages` stores the physical package cache:

```text
id
version
manifest_json
install_path
source_market_url
status
installed_at
updated_at
```

`user_installed_skills` stores the per-user install relationship:

```text
user_id
id
version
status
installed_at
updated_at
```

Installed packages are stored under:

```text
data/installed-skills/{publisher}/{name}/{version}
```

The legacy `skills/` root is still scanned and remains compatible. Installed skills are additionally scanned by canonical id, for example `official/pdf`.

Model/tool access uses virtual skill paths instead of absolute install paths:

```text
skills/official/pdf/SKILL.md
skills/official/pdf/scripts/...
```

The backend maps those paths to `data/installed-skills/official/pdf/{version}` after checking both:

1. the session `activeSkills` allowlist
2. the current user's `user_installed_skills` rows

## APIs

```text
GET  /api/market/skills
GET  /api/skills/installed
POST /api/skills/install
DELETE /api/skills/installed/{publisher}/{name}
GET  /api/me/skills/installed
POST /api/me/skills/install
DELETE /api/me/skills/{publisher}/{name}
```

`POST /api/skills/install` accepts:

```json
{
  "id": "official/pdf",
  "version": "1.0.0"
}
```

`marketBaseUrl` is optional in the request body; the server defaults to `MARKET_BASE_URL`.

## Install Flow

The server install service:

1. Fetches and validates the market manifest with `@qizhi/skill-spec`.
2. Downloads the `.tgz` package to staging.
3. Optionally validates `checksumSha256` when provided by market metadata.
4. Extracts into staging with path traversal checks.
5. Rejects hard links and symlinks.
6. Requires `skill.json` and `SKILL.md`.
7. Validates package `skill.json` with `@qizhi/skill-spec`.
8. Moves the package into `INSTALLED_SKILLS_ROOT`.
9. Persists or reuses the `skill_packages` cache row.
10. Persists the current user's `user_installed_skills` row.
11. Reloads `SkillRegistry` only when a package is newly unpacked.

Uninstall deletes only the current user's install relationship and removes that canonical skill id from the user's sessions. The cached package and prepared runtime are intentionally left in place for reuse by other users or future reinstalls.

## Runtime Script Guardrails

Installed market skills can execute scripts only when:

1. the skill is enabled in the current session
2. the skill is installed by the current user
3. `skill.json` declares `permissions.scripts: true`
4. `runtime.type` is not `none`
5. the requested script path is listed in `runtime.entrypoints`

Legacy local skills under `skills/` keep the previous compatibility behavior.

## Verification

Run:

```powershell
npm install
npm run typecheck
npm test
```

Current note: after Node upgrades, `better-sqlite3` may need `npm rebuild better-sqlite3`. If a SkillChat dev server is running, stop it first because Windows locks the native `.node` file while loaded.
