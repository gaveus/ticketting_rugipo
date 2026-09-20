/** Direct Aiven check — counts rows in every important table. Dev-only tool. */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Aiven requires SSL
});

(async () => {
  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1");
  console.log('TABLES:', tables.rows.map((r) => r.table_name).join(', '));
  for (const t of ['tickets', 'students', 'users', 'faculties', 'departments',
    'ticket_categories', 'ticket_issue_types', 'audit_logs', 'outbound_emails']) {
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
    console.log(`  ${t} = ${n.rows[0].n}`);
  }
  const users = await pool.query("SELECT email, role, active FROM users ORDER BY role");
  console.log('USERS:', JSON.stringify(users.rows));
  const tickets = await pool.query('SELECT ticket_number, student_name, status FROM tickets');
  console.log('TICKETS:', JSON.stringify(tickets.rows));
  await pool.end();
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
