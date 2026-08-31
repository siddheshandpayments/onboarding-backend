# Onboarding Platform — Compact Handoff (2026-08-31)

Paste this into a new chat. Full detail (if needed later) is in
`PROGRESS.md` next to this file.

## Where the code is
- **Real, running code**: `/Users/siddheshpandey/Desktop/Self Use/onboarding-backend`
  (git repo, port 3000, `nest start --watch`) and
  `.../onboarding-frontend-step38` (not a git repo, port 5173, Vite).
- `~/Downloads/onboarding-backend-step6` and `~/Downloads/onboarding-frontend`
  are an **older, unrelated copy** — ignore them.
- DB: `postgresql://siddheshpandey@localhost:5432/onboarding_db`. Migrate: `npm run migrate` in the backend dir.
- **Backend has 18 modified + 9 new files, NOTHING COMMITTED.** Ask before doing more work — commit first if the user wants safety.

## Stack
NestJS + TS + plain `pg` (no ORM) backend. React + Vite + TS frontend, no component library. Warm cream/amber color theme (andpayments.com-inspired), Outfit font.

## What's done (steps 1–38 baseline + this session)
- Full onboarding platform: auth (temp pw → reset → TOTP), RBAC, versioned templates, checkpoint dual-confirm, 3 dashboards, notes, entitlements, activity log, Community, documents backend.
- **Fixed a recurring bug**: 6 endpoints returned bare arrays instead of the `{data,total,limit,offset}` envelope the frontend expected → crashes. Fixed in knowledge, entitlements, notes, community, onboarding-tasks/mine, onboardings/stuck.
- **Task Owner role**: was unusable (no UI to create the account or find claimable tasks) — built both. HR: "+ Add task owner" button. Task owners: "Claimable tasks" list + claim button.
- **HR task scheduler**: overview (stat tiles, pipeline, needs-attention), click an onboarding → see full task list + "Schedule task" (ad-hoc task, outside the template).
- **Office-experience rating**: employee star-rating widget, HR sees company-wide average.
- **Company email automation** (biggest change): fixed a real deadlock bug that made company-email login impossible. HR now clicks "📧 Assign company email" (one button, no typing) → auto-generates `name@example.com` / `name1@example.com` on collision, issues temp password, auto-assigns unclaimed IT tasks to seeded user "Bhupendra". Old temp login correctly rejected after transition. **Verified working end-to-end live.**
- **New templates**: Engineering v2, Finance v2, Operations v1 (had none before). All share "Read docs → Meet manager → Company email & laptop (checkpoint)", diverge only on app-install checklist after that.
- **Documents page**: 4 example policy PDFs generated + uploaded, "Read online" (new tab) + "Download" both work.
- **Community**: Reddit-style up/down voting, comment removal (not just posts), AMA question tag + filter.
- **Notes privacy changed on request**: SuperAdmin can now read note *content* company-wide via `/notes/admin/all`, but the SQL never selects `user_id` — truly can't tell whose note it is.
- **Full UI redesign**: journey-track roadmap (animates 1→2→3... on every load), animated progress bars, scroll-reveal on every section, universal hover-lift everywhere, 14 Mac tips, Office Attendance external link, phone-number input validators (digits only).
- **Fixed**: invisible white-on-white button text in popups (CSS `[type='submit']` gotcha). **Fixed**: pantry/washroom knowledge cards used to disappear after checkpoint — now persist via `/knowledge/public` fallback.

## Test credentials (local dev only)
| Role | Login | Password | TOTP |
|---|---|---|---|
| SuperAdmin | `bootstrap.admin@id.onboarding.internal` | `SuperAdmin123` | enrolled, secret **drifts unexplained** — re-read from DB if "invalid code" |
| Employee | `fixverifytest@example.com` | `FixVerifyNew123` | enrolled |
| Task Owner | `taskowner.test.ldsksf@id.onboarding.internal` | `TaskOwner123` | **not enrolled**, expect a QR screen |
| Task Owner "Bhupendra" (seed, IT auto-assign target) | `bhupendra@id.onboarding.internal` | `Bhupendra123` | not enrolled, never logged in |

Get a live TOTP code without a phone:
```bash
psql "postgresql://siddheshpandey@localhost:5432/onboarding_db" -t -c "SELECT totp_secret FROM users WHERE temp_login_email='<login>';"
node -e "const {authenticator}=require('./node_modules/otplib');console.log(authenticator.generate('<secret>'))"
```
(run the node command from inside the backend dir so `otplib` resolves)

## Known gaps / not built
- Finance/Operations app-checklist tool names are placeholders — confirm with user.
- AMA is public-only (private buddy channel discussed, not built).
- Milestone-based (Day1/Week1/Month1) journey track discussed as an alternative, not built.
- No admin UI for document upload (done via curl this session).
- Frontend has no git repo — no rollback safety net for frontend edits.

Start a new chat by asking the user what they've tested/broken since this was written, don't assume it's all still working.
