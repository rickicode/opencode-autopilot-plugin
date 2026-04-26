## 2026-04-26 00:00 [saved]
Goal: Preserve autopilot command investigation.
Decisions:
- Mirror `oh-my-opencode-slim` command pattern because it is the closest upstream reference.
- Keep findings in repo markdown because runtime behavior needs future re-checks.
- Treat `.a5c/` and tarballs as generated artifacts because they should not pollute commits.
Rejected:
- Assuming plugin architecture alone explains `/autopilot` failure.
- Committing assistant cache artifacts.
Open:
- Verify host runtime hook semantics upstream.
- Push current repo snapshot first.
