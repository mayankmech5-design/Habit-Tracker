Dependency upgrade proposal

Purpose
-------
This branch contains audit reports before/after the `npm audit fix --force` run and proposes a safer approach: revert the forced changes and open focused PRs per dependency (or small related sets) to review and test upgrades.

Recommended workflow
--------------------
1. Review `audit-before-revert.json` to see current vulnerabilities in the original lockfile.
2. For each high/critical vulnerability, create a small focused PR that updates only the affected package (or its direct maintainer dependency) and run CI + app smoke tests.
3. Where an update would be a breaking change (major version bump), open a draft PR and add testing notes for manual verification.
4. Keep `package-lock.json` changes minimal per PR; do not run `npm audit fix --force` on main again.

Files in this branch
--------------------
- `audit-before-revert.json` — audit after revert (shows vulnerabilities to address)
- `audit-after-force.json` — audit captured before revert (shows state after force-fix)

Suggested first PRs
-------------------
- Update `uuid` to latest compatible version in the packages that depend on it.
- Replace `request`/`request-promise-native` usages or update transitive deps that depend on it.
- Update `qs`, `tough-cookie`, and `form-data` via targeted package updates.

If you'd like, I can open focused PRs for the top 3 highest-severity advisories automatically (one branch per PR) and include test notes.
