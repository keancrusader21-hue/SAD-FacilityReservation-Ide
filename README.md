# Role-Based Facility Reservation and Approval System
Laboratory 4 - Section B | Systems Analysis and Design

## 1. Setup

### A. Supabase project
1. Go to https://supabase.com → New Project.
2. Open **SQL Editor** → paste the entire contents of `supabase-schema.sql` → Run.
   This creates all tables, triggers (business rules + audit logging), and RLS policies, and seeds 3 sample facilities.
3. Go to **Project Settings → API** and copy your **Project URL** and **anon public key**.
4. Open `js/supabaseClient.js` and paste them in place of `YOUR_SUPABASE_PROJECT_URL` and `YOUR_SUPABASE_ANON_KEY`.
5. In **Authentication → Providers**, make sure Email is enabled. For a class demo, you can also disable "Confirm email" under Authentication → Settings so test accounts can log in immediately.

### B. Create your first Administrator
Sign-up on the app lets you pick a role (for demo/testing convenience). Create one account with role **Administrator** first — you'll need it to approve reservations and manage facilities.

### C. GitHub Pages
1. Create a repo named `SAD-FacilityReservation-Ide`.
2. Push all files (`index.html`, `dashboard.html`, `css/`, `js/`, `supabase-schema.sql`, this `README.md`).
3. Repo → Settings → Pages → Deploy from branch → `main` / `root`.
4. Live URL: `https://<your-username>.github.io/SAD-FacilityReservation-Ide/`

## 2. Role-Permission Matrix

| Role | Permitted Functions |
|---|---|
| Administrator | Manage facilities and users; approve/reject reservations; view service concerns, reports, and audit logs |
| Facility Staff | View reservations; confirm facility usage (mark In Use); record completion; create service requests; update facility condition |
| Requester | View facilities; submit reservation requests; view status; cancel own eligible (Pending) requests; view history |

## 3. Reservation Workflow

```
Reservation Submitted → Pending → Administrator Review → Approved / Rejected
If Approved → Scheduled → In Use → Completed
(Pending requests may also be Cancelled by their owner)
```
Statuses: `pending, approved, rejected, scheduled, in_use, completed, cancelled`

Note: in this implementation, "Approved" and "Scheduled" collapse into one step — the `enforce_reservation_rules()` trigger automatically moves a reservation from `approved` to `scheduled` the instant it's approved (BR-B4-06), since approval *is* what reserves the slot.

## 4. Business Rules (enforced server-side via Postgres triggers/RLS — not just in the UI)

| ID | Rule | Enforced by |
|---|---|---|
| BR-B4-01 | Only active facilities may be reserved | `enforce_reservation_rules()` trigger |
| BR-B4-02 | Reservation start must precede end time | table CHECK constraint + trigger |
| BR-B4-03 | Overlapping approved schedules are prohibited | `enforce_reservation_rules()` overlap query |
| BR-B4-04 | Only Administrator may approve reservations | RLS policy + UI role check |
| BR-B4-05 | Rejected reservations cannot become Scheduled | `enforce_reservation_rules()` trigger |
| BR-B4-06 | Approved reservations reserve the time slot | trigger auto-transitions to `scheduled` |
| BR-B4-07 | Completed reservations cannot be edited | `enforce_reservation_rules()` trigger |
| BR-B4-08 | Facilities under Maintenance cannot be reserved | `enforce_reservation_rules()` trigger |
| BR-B4-09 | Requesters may modify only their own Pending requests | RLS UPDATE/DELETE policy |
| BR-B4-10 | Approval and status changes must be logged | `log_reservation_change()` / `log_facility_change()` triggers |

## 5. ERD (entities and relationships)

```
profiles (1) ───< reservations (many)      [profiles.id = reservations.requester_id]
profiles (1) ───< reservations (many)      [profiles.id = reservations.reviewed_by]
profiles (1) ───< service_requests (many)  [profiles.id = service_requests.staff_id]
facilities (1) ───< reservations (many)    [facilities.id = reservations.facility_id]
facilities (1) ───< service_requests (many)[facilities.id = service_requests.facility_id]
profiles (1) ───< audit_logs (many)        [profiles.id = audit_logs.actor_id]
```
Key attributes:
- **profiles**: id (PK, = auth.users.id), full_name, role {admin, staff, requester}
- **facilities**: id (PK), name, description, location, capacity, status {active, maintenance, inactive}
- **reservations**: id (PK), facility_id (FK), requester_id (FK), purpose, start_time, end_time, status, reviewed_by (FK)
- **service_requests**: id (PK), facility_id (FK), staff_id (FK), description, status
- **audit_logs**: id (PK), actor_id (FK), action, entity_type, entity_id, details (jsonb), created_at

## 6. Use Case Diagram (actors and use cases)

```
Administrator:
  - Manage Facilities (Add/Update/Delete)
  - Approve/Reject Reservation
  - View Audit Log
  - View Service Concerns

Facility Staff:
  - View Reservations
  - Mark Facility In Use / Completed
  - Log Service Request
  - Update Facility Condition (status)

Requester:
  - View Facilities
  - Submit Reservation Request
  - View Reservation Status/History
  - Cancel Own Pending Request
```

## 7. Manual Test Script (TC-B4-01 to TC-B4-10)

| Test ID | Steps | Expected |
|---|---|---|
| TC-B4-01 | Log in as Requester → Facilities → Reserve an active facility → submit | Row appears in Reservations with status **Pending** |
| TC-B4-02 | Submit a reservation for a facility/time that overlaps an already-Approved one | Insert/approve blocked with a schedule-conflict error |
| TC-B4-03 | Log in as Administrator → Reservations → Approve a Pending request | Status becomes **Scheduled** |
| TC-B4-04 | As Administrator, Reject a Pending request | Status becomes **Rejected** |
| TC-B4-05 | Log in as Facility Staff → mark a Scheduled reservation "In Use" | Status updates to **In Use** |
| TC-B4-06 | As Facility Staff, mark an In Use reservation "Complete" | Status becomes **Completed** |
| TC-B4-07 | As Requester A, try to edit/cancel Requester B's request (e.g. via API) | Blocked by RLS policy |
| TC-B4-08 | Set a facility's status to Maintenance → try to reserve it | Blocked with an error from the trigger |
| TC-B4-09 | As Administrator, open Audit Log | Approval/status-change entries are visible |
| TC-B4-10 | Log out → open `dashboard.html` directly | Redirected to `index.html` (access denied) |

## 8. Submission Checklist
- [ ] GitHub repository URL
- [ ] Live GitHub Pages URL
- [ ] Updated ERD and Use Case Diagram (Section 5 & 6 above, or exported as image)
- [ ] Role-permission matrix (Section 2)
- [ ] Reservation workflow (Section 3)
- [ ] Business rules (Section 4)
- [ ] Audit-log screenshot (Administrator → Audit Log view)
- [ ] Functional test results (Section 7, filled in with Pass/Fail)
