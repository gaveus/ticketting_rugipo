/**
 * READ-ONLY verification for the search/resolver fixes — prints what the
 * live endpoints would now return. Run: node scripts/verify-fixes.js
 */
const { db, readyPromise } = require('../db');

(async () => {
  await readyPromise();

  console.log('=== 1. audit-log search (used to crash) ===');
  const where = []; const params = [];
  const ticket = 'RGP-2026-F0006';
  where.push('t.ticket_number ILIKE ?'); params.push(`%${ticket}%`);
  const rows = await db.all(`SELECT a.id, a.actor_name, a.action, a.created_at,
             t.ticket_number, t.student_name, i.name AS issue
      FROM audit_logs a
      LEFT JOIN tickets t ON t.id = a.entity_id AND a.entity_type = 'ticket'
      LEFT JOIN ticket_issue_types i ON i.id = t.issue_type_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.created_at DESC
      LIMIT ?`, ...params, 200);
  console.log(`OK — ${rows.length} entries for ${ticket}`);
  for (const r of rows.slice(0, 5)) console.log(`  ${r.ticket_number} | ${r.action} | by ${r.actor_name}`);

  console.log('\n=== 2. tickets list resolver data ===');
  const list = await db.all(`SELECT t.id, t.ticket_number, t.status,
            s.full_name AS assigned_staff,
            (SELECT m.sender_name FROM ticket_messages m WHERE m.ticket_id = t.id AND m.sender_role IN ('staff','senior','admin') ORDER BY m.id DESC LIMIT 1) AS attended_by_name,
            (SELECT h.changed_by FROM ticket_status_history h WHERE h.ticket_id = t.id AND h.new_status IN ('resolved','closed')
                AND h.changed_by IS NOT NULL AND h.changed_by NOT IN ('student','system')
                ORDER BY h.id DESC LIMIT 1) AS resolved_by_name
     FROM tickets t
     LEFT JOIN users s ON s.id = t.assigned_staff_id
     ORDER BY t.created_at DESC LIMIT 200`);
  for (const t of list) {
    const label = t.assigned_staff
      ? (t.resolved_by_name && ['resolved', 'closed'].includes(t.status)
          ? (t.resolved_by_name !== t.assigned_staff ? `${t.assigned_staff} — resolved by ${t.resolved_by_name}` : `${t.assigned_staff} — resolved this complaint`)
          : (t.attended_by_name && t.attended_by_name !== t.assigned_staff ? `${t.assigned_staff} — attended by ${t.attended_by_name}` : `${t.assigned_staff} — not attended yet`))
      : (t.resolved_by_name && ['resolved', 'closed'].includes(t.status) ? `${t.resolved_by_name} — resolved (no hand-over)` : t.attended_by_name ? `${t.attended_by_name} — attended (no hand-over)` : 'Unassigned — nobody on it yet');
    console.log(`  ${t.ticket_number} [${t.status}] → ${label}`);
  }

  console.log('\n=== 3. dashboard recent (officer column) ===');
  const recent = await db.all(`SELECT t.ticket_number, s.full_name AS assigned,
            (SELECT h.changed_by FROM ticket_status_history h WHERE h.ticket_id = t.id AND h.new_status IN ('resolved','closed')
                AND h.changed_by IS NOT NULL AND h.changed_by NOT IN ('student','system')
                ORDER BY h.id DESC LIMIT 1) AS resolved_by
     FROM tickets t
     LEFT JOIN users s ON s.id = t.assigned_staff_id
     ORDER BY t.created_at DESC LIMIT 8`);
  for (const r of recent) console.log(`  ${r.ticket_number} → ${r.assigned || (r.resolved_by ? `${r.resolved_by} (resolved)` : 'Unassigned')}`);

  console.log('\n=== 4. reports: departments / faculty / level (complaints vs students) ===');
  const byDept = await db.all(`SELECT COALESCE(t.department,'(none)') AS dept, COUNT(*)::int AS n, COUNT(DISTINCT t.email)::int AS students FROM tickets t GROUP BY dept ORDER BY n DESC LIMIT 5`);
  for (const d of byDept) console.log(`  ${d.dept} — ${d.n} complaint(s) from ${d.students} student(s)`);
  const byFac = await db.all(`SELECT COALESCE(f.name,'(none)') AS faculty, COUNT(*)::int AS n, COUNT(DISTINCT t.email)::int AS students FROM tickets t LEFT JOIN faculties f ON f.id = t.faculty_id GROUP BY f.id ORDER BY n DESC LIMIT 5`);
  for (const d of byFac) console.log(`  ${d.faculty} — ${d.n} complaint(s) from ${d.students} student(s)`);
  const byLvl = await db.all(`SELECT COALESCE(t.academic_level,'(none)') AS lvl, COALESCE(t.study_mode,'(none)') AS mode, COUNT(*)::int AS n, COUNT(DISTINCT t.email)::int AS students FROM tickets t GROUP BY lvl, mode ORDER BY n DESC LIMIT 5`);
  for (const d of byLvl) console.log(`  ${d.lvl} · ${d.mode} — ${d.n} complaint(s) from ${d.students} student(s)`);

  console.log('\n=== 5. officers on duty (no-hand-over credit) ===');
  const wl = await db.all(`SELECT COALESCE(s.full_name,
     (SELECT h.changed_by FROM ticket_status_history h WHERE h.ticket_id = t.id AND h.new_status IN ('resolved','closed')
        AND h.changed_by IS NOT NULL AND h.changed_by NOT IN ('student','system')
        ORDER BY h.id DESC LIMIT 1), '(unassigned)') AS staff, COUNT(*)::int AS n,
     COUNT(*) FILTER (WHERE t.status IN ('resolved','closed'))::int AS done
     FROM tickets t LEFT JOIN users s ON s.id=t.assigned_staff_id GROUP BY s.id, staff ORDER BY n DESC`);
  for (const w of wl) console.log(`  ${w.staff} — ${w.n} (${w.done} solved)`);

  process.exit(0);
})().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
