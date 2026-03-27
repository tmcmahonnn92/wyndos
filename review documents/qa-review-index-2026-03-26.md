# QA Review Index

Date: 2026-03-26

This review set documents the full local QA pass completed against the Window Cleaning App on a locally started development server.

Included documents:

- [qa-test-report-2026-03-26.md](qa-test-report-2026-03-26.md): confirmed defects, verified behavior, blockers, and coverage gaps
- [qa-execution-notes-2026-03-26.md](qa-execution-notes-2026-03-26.md): environment setup, accounts used, test data created, and reproducibility notes
- [uk-compliance-fix-focused-review-2026-03-26.md](uk-compliance-fix-focused-review-2026-03-26.md): existing compliance-focused review already present in this folder

High-level outcome:

- Multi-user and multi-tenant isolation held in the flows tested
- Worker permission redirects held for restricted routes in the flows tested
- Cross-area one-off behavior worked for the current occurrence and returned the customer on the next normal cycle
- Two important product issues were confirmed in active flows: owner onboarding hangs after save, and recurrence is based on the scheduled date instead of the actual completion date
- Local bootstrap is currently unreliable because Prisma migration history, current schema, and seed script are out of sync

Recommended reading order:

1. Read the findings report first
2. Read the execution notes second if you need to reproduce the same environment
3. Read the compliance review separately for production hardening work