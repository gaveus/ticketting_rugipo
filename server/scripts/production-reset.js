/**
 * Production reset — removes every test/fake artifact from the database,
 * keeping: official master data (faculties, departments, service catalogue)
 * and the Super ICT Support account(s). Everything staff- or ticket-related
 * that was created during testing is wiped so the system starts clean.
 *
 * Run from server/:  node scripts/production-reset.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db, readyPromise } = require('../db');

async function main() {
  await readyPromise();

  const before = {
    tickets: (await db.get('SELECT COUNT(*)::int AS n FROM tickets')).n,
    students: (await db.get('SELECT COUNT(*)::int AS n FROM students')).n,
    users: (await db.get('SELECT COUNT(*)::int AS n FROM users')).n,
    emails: (await db.get('SELECT COUNT(*)::int AS n FROM outbound_emails')).n,
    audit: (await db.get('SELECT COUNT(*)::int AS n FROM audit_logs')).n,
    subscribers: (await db.get('SELECT COUNT(*)::int AS n FROM subscribers')).n,
  };
  console.log('Before:', JSON.stringify(before));

  // Order matters (FK references). attachments first, then dependent rows.
  await db.exec(`
    DELETE FROM ticket_attachments;
    DELETE FROM ticket_payment_details;
    DELETE FROM ticket_assignments;
    DELETE FROM ticket_messages;
    DELETE FROM ticket_status_history;
    DELETE FROM escalations;
    DELETE FROM outbound_emails;
    DELETE FROM audit_logs;
    DELETE FROM tickets;
    DELETE FROM subscribers;
    DELETE FROM students;
    DELETE FROM users WHERE role != 'admin';
  `);

  // Reset the ticket-number sequence so real tickets start at RGP-…-00001.
  await db.exec(`DROP SEQUENCE IF EXISTS ticket_number_seq; CREATE SEQUENCE ticket_number_seq START 1;`);

  const after = {
    tickets: (await db.get('SELECT COUNT(*)::int AS n FROM tickets')).n,
    students: (await db.get('SELECT COUNT(*)::int AS n FROM students')).n,
    users: (await db.get("SELECT COUNT(*)::int AS n FROM users WHERE role != 'admin'")).n,
    adminsKept: (await db.get("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'")).n,
    faculties: (await db.get('SELECT COUNT(*)::int AS n FROM faculties')).n,
    departments: (await db.get('SELECT COUNT(*)::int AS n FROM departments')).n,
    categories: (await db.get('SELECT COUNT(*)::int AS n FROM ticket_categories')).n,
    issueTypes: (await db.get('SELECT COUNT(*)::int AS n FROM ticket_issue_types')).n,
  };
  console.log('After :', JSON.stringify(after));
  console.log('Super accounts kept:');
  for (const a of await db.all("SELECT email, full_name, role, active FROM users WHERE role = 'admin'")) {
    console.log('  -', a.email, `(${a.full_name}, active=${a.active})`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
