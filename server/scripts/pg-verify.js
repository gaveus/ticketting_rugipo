require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const q = (s) => p.query(s).then((r) => r.rows);
  const [facs, deps, issues, cats, users, tickets] = await Promise.all([
    q('SELECT COUNT(*)::int n FROM faculties'),
    q('SELECT COUNT(*)::int n FROM departments'),
    q('SELECT COUNT(*)::int n FROM ticket_issue_types'),
    q("SELECT name FROM ticket_categories WHERE active=1 ORDER BY sort_order"),
    q('SELECT email, role FROM users ORDER BY id'),
    q('SELECT COUNT(*)::int n FROM tickets'),
  ]);
  console.log('faculties:', facs[0].n, '| departments:', deps[0].n, '| issue types:', issues[0].n, '| tickets:', tickets[0].n);
  console.log('categories:', cats.map((r) => r.name).join(' | '));
  console.log('users:', users.map((r) => r.email + ' (' + r.role + ')').join(', '));
  await p.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
