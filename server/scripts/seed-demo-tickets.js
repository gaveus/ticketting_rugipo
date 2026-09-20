/**
 * DEV-ONLY demo seeder — inserts 5 realistic tickets so the dashboard shows
 * meaningful numbers. All use example.com emails (never deliverable to real
 * students). Remove anytime with scripts/production-reset.js.
 * Run:  node scripts/seed-demo-tickets.js
 */
const { db, readyPromise, nextTicketNumber } = require('../db');

const NAMES = [
  ['Adeyemi Grace', 'RGP/CSC/23/0123', 'grace.demo@example.com'],
  ['Okafor Emmanuel', 'RGP/STA/22/0451', 'emeka.demo@example.com'],
  ['Bello Fatima', 'RGP/BFN/24/0209', 'fatima.demo@example.com'],
  ['Ogunleye Tunde', 'RGP/MEE/23/0317', 'tunde.demo@example.com'],
  ['Aina Blessing', 'RGP/CSC/24/0118', 'blessing.demo@example.com'],
];
const DESCRIPTIONS = [
  'I paid my school fees on Monday but the portal still shows unpaid and I cannot register courses.',
  'I cannot log into the student portal with my matric number, it says invalid credentials.',
  'My exam results for last semester are not showing on the portal.',
  'The course registration page keeps logging me out whenever I click submit.',
  'My payment was successful but the receipt page is blank when I try to download it.',
];
const STATUSES = ['open', 'open', 'in_progress', 'resolved', 'open'];

(async () => {
  await readyPromise();

  const issues = await db.all('SELECT id, name, category_id FROM ticket_issue_types ORDER BY id');
  const depts = await db.all("SELECT id, name, faculty_id FROM departments WHERE kind = 'academic' ORDER BY id LIMIT 10");

  for (let i = 0; i < NAMES.length; i++) {
    const [fullName, matric, email] = NAMES[i];
    const issue = issues[i % issues.length];
    const d = depts[i % depts.length];
    const tnum = await nextTicketNumber();
    const tx = db.transaction(async () => {
      const t = await db.run(
        `INSERT INTO tickets (ticket_number, student_name, matric_no, reg_no, phone, email, department,
           level, programme, category_id, issue_type_id, description, status, faculty_id, department_id,
           academic_level, study_mode, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        tnum, fullName, matric, `RGP/2023/SC/000${i}`, `0803123456${i}`, email, d.name,
        'ND1', 'National Diploma', issue.category_id, issue.id, DESCRIPTIONS[i], STATUSES[i],
        d.faculty_id, d.id, 'ND1', 'FULL_TIME',
        STATUSES[i] === 'resolved' ? new Date() : null);
      await db.run('INSERT INTO ticket_status_history (ticket_id, new_status, changed_by, note) VALUES (?, ?, ?, ?)',
        t.lastInsertRowid, 'open', 'system', 'Complaint submitted');
      if (STATUSES[i] === 'resolved') {
        await db.run('INSERT INTO ticket_status_history (ticket_id, old_status, new_status, changed_by, note) VALUES (?, ?, ?, ?, ?)',
          t.lastInsertRowid, 'open', 'resolved', 'Demo Officer', 'Verified and corrected on the portal');
      }
      await db.run('INSERT INTO subscribers (email, name, matric_no, source) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
        email, fullName, matric, 'complaint');
    });
    await tx();
    console.log('created', tnum, '→', STATUSES[i]);
  }
  const c = await db.get('SELECT COUNT(*)::int AS n FROM tickets');
  console.log('total tickets now:', c.n);
  process.exit(0);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
