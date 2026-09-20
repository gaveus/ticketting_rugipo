/**
 * Seeds the official RUGIPO master data per the institution's structure:
 * faculties → departments/units (academic vs administrative vs center),
 * the ICT service catalogue (categories + guided questions), issue types,
 * and the initial staff/senior/admin accounts with staff IDs.
 *
 * The Super ICT Support account is seeded once; all other staff accounts are
 * created through the portal by a Super admin (Administration → Accounts).
 *
 * Safe to re-run — everything is INSERT OR IGNORE / update-if-empty.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db } = require('./db');

/* ------------------ faculties → departments (master data) ----------------- */

const FACULTIES = [
  ['Agricultural Technology', [
    ['Agricultural Extension and Management', 'academic'],
    ['Agricultural Technology', 'academic'],
    ['Animal Health and Production', 'academic'],
    ['Crop Production Technology', 'academic'],
    ['Fisheries and Aquaculture Technology', 'academic'],
    ['Forestry and Wood Technology', 'academic'],
    ['Home and Rural Economics', 'academic'],
    ['Horticultural Technology', 'academic'],
    ['Pest Management Technology', 'academic'],
  ]],
  ['Applied Sciences', [
    ['Computer Science', 'academic'],
    ['Food Science Technology', 'academic'],
    ['Hospitality Management Technology', 'academic'],
    ['Leisure and Tourism Management', 'academic'],
    ['Nutrition and Dietetics', 'academic'],
    ['Office Technology Management', 'academic'],
    ['Pharmaceutical Technology', 'academic'],
    ['Science Laboratory Technology', 'academic'],
    ['Statistics', 'academic'],
  ]],
  ['Business Studies', [
    ['Accountancy', 'academic'],
    ['Banking and Finance', 'academic'],
    ['Business Administration Management', 'academic'],
    ['Cooperative Economics and Management', 'academic'],
    ['Insurance', 'academic'],
    ['Marketing', 'academic'],
    ['Micro Finance and Enterprise Development', 'academic'],
    ['Public Administration', 'academic'],
    ['Taxation', 'academic'],
  ]],
  ['Engineering Technology', [
    ['Agricultural and Bio-Environment Engineering Technology', 'academic'],
    ['Civil Engineering Technology', 'academic'],
    ['Computer Engineering Technology', 'academic'],
    ['Electrical/Electronics Engineering Technology', 'academic'],
    ['Mechanical Engineering Technology', 'academic'],
    ['Mechatronics Engineering Technology', 'academic'],
    ['Welding and Fabrication Engineering Technology', 'academic'],
  ]],
  ['Environmental Studies', [
    ['Architectural Technology', 'academic'],
    ['Art and Design', 'academic'],
    ['Building Technology', 'academic'],
    ['Estate Management', 'academic'],
    ['Quantity Surveying', 'academic'],
    ['Surveying and Geo-Informatics', 'academic'],
    ['Transportation Planning and Management', 'academic'],
    ['Academic', 'academic'],
    ['Urban and Regional Planning', 'academic'],
  ]],
  ['Social Sciences and Communication Studies', [
    ['Library and Information Science', 'academic'],
    ['Mass Communication', 'academic'],
    ['Social Development', 'academic'],
  ]],
  // Institutional center, not an academic department.
  ['Artisan Center', [['Artisan Center', 'center']]],
  // Administrative units / services (spec §11) — not academic departments.
  ['School Management and Administration', [
    ['Bursary', 'unit'],
    ['Information and Communication Technology', 'unit'],
    ['Information Unit', 'unit'],
    ['Laboratory', 'unit'],
    ['Library', 'unit'],
    ['Medical Services', 'unit'],
    ['Registry', 'unit'],
    ['School Management and Administration', 'unit'],
    ['Security', 'unit'],
    ['Works', 'unit'],
  ]],
];

/* ------------------- ICT service catalogue + guided questions ---------------- */

// guided_fields: JSON array rendered by the wizard. type: text|textarea|select.
const CATEGORIES = [
  ['Payment', 'Payments made through the school portal (Appiawave) that did not go as expected.',
    1, [
    { name: 'paidFor', label: 'What did you pay for?', type: 'text', placeholder: 'e.g. school fees, departmental dues' },
    { name: 'amount', label: 'How much did you pay?', type: 'text', placeholder: 'e.g. 45,500' },
    { name: 'paymentDate', label: 'When did you make the payment?', type: 'text', placeholder: 'e.g. 12 March 2026' },
    { name: 'paymentChannel', label: 'How did you pay?', type: 'select',
      options: ['Online (card / transfer in the portal)', 'Bank branch', 'POS', 'USSD', 'Other'] },
  ]],
  ['Receipt', 'Receipt generation, download and printing problems.', 2, [
    { name: 'receiptType', label: 'Which receipt is it? (school fees, departmental dues…)', type: 'text' },
    { name: 'errorMessage', label: 'What error or behaviour do you see?', type: 'textarea' },
  ]],
  ['Account / Login', 'Signing in, passwords and account access.', 3, [
    { name: 'whenStarted', label: 'When did the problem start?', type: 'text', placeholder: 'e.g. since last week' },
    { name: 'errorMessage', label: 'Exact error message (if any)', type: 'text' },
    { name: 'device', label: 'What device are you using?', type: 'select', options: ['Phone', 'Laptop', 'Desktop', 'Tablet'] },
  ]],
  ['Course Registration / Course Form', 'Registering courses and printing your course form.', 4, [
    { name: 'courseDetails', label: 'Which course(s) or level is affected?', type: 'textarea' },
    { name: 'errorMessage', label: 'Exact error message (if any)', type: 'text' },
    { name: 'device', label: 'What device are you using?', type: 'select', options: ['Phone', 'Laptop', 'Desktop', 'Tablet'] },
  ]],
  ['Results / Academic Records', 'Missing or incorrect results and academic records.', 5, [
    { name: 'semester', label: 'Which semester?', type: 'select',
      options: ['ND 1 First Semester', 'ND 1 Second Semester', 'ND 2 First Semester', 'ND 2 Second Semester',
        'HND 1 First Semester', 'HND 1 Second Semester', 'HND 2 First Semester', 'HND 2 Second Semester'] },
    { name: 'session', label: 'Which academic session?', type: 'text', placeholder: 'e.g. 2024/2025' },
    { name: 'errorMessage', label: 'What exactly is wrong with the result?', type: 'textarea' },
  ]],
  ['Student Portal', 'Portal pages, errors and features not working.', 6, [
    { name: 'pageAffected', label: 'Which page or feature is affected?', type: 'text', placeholder: 'e.g. school fees payment page' },
    { name: 'errorMessage', label: 'Exact error message (if any)', type: 'textarea' },
    { name: 'browser', label: 'Which browser?', type: 'select', options: ['Chrome', 'Safari', 'Firefox', 'Opera Mini', 'Other'] },
    { name: 'device', label: 'What device are you using?', type: 'select', options: ['Phone', 'Laptop', 'Desktop', 'Tablet'] },
  ]],
  ['Student Information', 'Wrong personal or academic information on file.', 7, [
    { name: 'whatIsWrong', label: 'What information is wrong?', type: 'textarea' },
    { name: 'correctInformation', label: 'What should it say instead?', type: 'textarea' },
  ]],
  ['Printing / Documents', 'Printing or downloading documents.', 8, [
    { name: 'documentName', label: 'Which document?', type: 'text' },
    { name: 'errorMessage', label: 'What happens when you try?', type: 'textarea' },
  ]],
  ['CBT / E-Assessment', 'Computer-based tests and assessments.', 11, [
    { name: 'courseName', label: 'Which course / assessment?', type: 'text' },
    { name: 'errorMessage', label: 'What went wrong?', type: 'textarea' },
  ]],
  ['Admission Portal', 'Admission status, acceptance and letters.', 12, [
    { name: 'issueKind', label: 'What is the problem?', type: 'select',
      options: ['Admission status not showing', 'Cannot accept admission', 'Admission letter will not download', 'Other'] },
    { name: 'errorMessage', label: 'Exact error message (if any)', type: 'text' },
  ]],
  ['Other', 'Anything else — tell us in your own words.', 99, [
    { name: 'tried', label: 'What were you trying to do?', type: 'textarea' },
    { name: 'happened', label: 'What happened instead?', type: 'textarea' },
    { name: 'expected', label: 'What did you expect to happen?', type: 'textarea' },
    { name: 'errorText', label: 'What error message did you see, if any?', type: 'text' },
  ]],
];

const ISSUES = {
  'Payment': [
    ['Expired payment link', 1], ['Payment made but portal still shows unpaid', 1],
    ['Payment made for wrong item', 1], ['School-fee payment issue', 1],
    ['Wrong payment amount', 1], ['Other payment issue', 1],
  ],
  'Receipt': [
    ['Payment successful but receipt unavailable', 0],
    ['Receipt information is incorrect', 0], ['Other receipt issue', 0],
  ],
  'Account / Login': [
    ['Cannot log in', 0], ['Forgot password', 0], ['Matric number not recognized', 0],
    ['Duplicate account', 0], ['Account not activated', 0],
    ['Incorrect student information', 0], ['Profile problem', 0],
  ],
  'Course Registration / Course Form': [
    ['Cannot register a course', 0], ['Course missing', 0], ['Wrong course displayed', 0],
    ['Registration not saved', 0], ['Course form unavailable', 0],
    ['Cannot print course form', 0], ['Registered course missing', 0],
  ],
  'Results / Academic Records': [
    ['Result missing', 0], ['Incorrect result displayed', 0], ['Result not updated', 0],
    ['Wrong semester/session', 0], ['Academic-record portal problem', 0],
  ],
  'Student Portal': [
    ['Page not loading', 0], ['Error message', 0], ['Feature not working', 0],
    ['Mobile display problem', 0], ['Dashboard problem', 0],
    ['Registration page problem', 0],
  ],
  'Student Information': [
    ['Wrong name', 0], ['Wrong matric number', 0], ['Wrong department', 0],
    ['Wrong programme', 0], ['Wrong level', 0], ['Incorrect personal information', 0],
  ],
  'Printing / Documents': [
    ['Cannot print', 0], ['Document will not download', 0], ['Blank document', 0],
    ['Incorrect document', 0], ['PDF generation problem', 0],
  ],
  'CBT / E-Assessment': [
    ['Cannot log in to CBT platform', 0], ['Assessment not submitting', 0],
    ['Question display problem', 0], ['Score not recorded', 0], ['Other CBT issue', 0],
  ],
  'Admission Portal': [
    ['Admission status not showing', 0], ['Cannot accept admission', 0],
    ['Admission letter will not download', 0], ['Other admission issue', 0],
  ],
  'Other': [['Other issue not listed', 0]],
};

const STAFF = [
  // Super ICT Support — the owner account. Other accounts (ICT Support or
  // Senior Engineer) are created from the portal by a Super admin only.
  // Credentials come from server/.env (SUPER_EMAIL / SUPER_PASSWORD) —
  // NEVER hardcode a real email or password in this file; it ships to git.
  { role: 'admin', name: process.env.SUPER_NAME || 'Super ICT Support',
    email: (process.env.SUPER_EMAIL || '').toLowerCase(),
    pw: process.env.SUPER_PASSWORD || '',
    staffNo: process.env.SUPER_STAFF_NO || 'ICT/RGP/001',
    unit: 'Information and Communication Technology' },
].filter((u) => u.email && u.pw);

/**
 * Seeds everything inside ONE transaction. Idempotent: existing rows are kept,
 * missing ones are inserted (ON CONFLICT DO NOTHING / update-if-empty).
 */
async function seedMasterData() {
  const run = db.transaction(async () => {
    // Faculties + departments/units.
    for (const [faculty, deps] of FACULTIES) {
      await db.run(`INSERT INTO faculties (name, sort_order) VALUES (?, ?)
                    ON CONFLICT (name) DO NOTHING`, faculty, FACULTIES.findIndex(([f]) => f === faculty) + 1);
      const f = await db.get('SELECT id FROM faculties WHERE name = ?', faculty);
      for (const [name, kind] of deps) {
        await db.run(`INSERT INTO departments (name, faculty_id, kind) VALUES (?, ?, ?)
                      ON CONFLICT (name, faculty_id) DO NOTHING`, name, f.id, kind);
      }
    }

    // Service catalogue + guided questions (update only when empty — keeps admin edits).
    for (const [name, desc, order, guided] of CATEGORIES) {
      await db.run(
        `INSERT INTO ticket_categories (name, description, guided_fields, sort_order) VALUES (?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET
           guided_fields = COALESCE(ticket_categories.guided_fields, excluded.guided_fields),
           sort_order = excluded.sort_order`,
        name, desc, guided ? JSON.stringify(guided) : null, order);
    }

    const issues = await db.all(`SELECT c.id AS cid, c.name AS cname FROM ticket_categories c`);
    const catByName = Object.fromEntries(issues.map((c) => [c.cname, c.cid]));
    for (const [catName, list] of Object.entries(ISSUES)) {
      for (const [name, pays] of list) {
        await db.run(
          `INSERT INTO ticket_issue_types (category_id, name, requires_payment_details)
           SELECT ?, ?, ? WHERE NOT EXISTS (
             SELECT 1 FROM ticket_issue_types WHERE category_id = ? AND LOWER(name) = LOWER(?))`,
          catByName[catName], name, pays, catByName[catName], name);
      }
    }

    // Super ICT Support account — seeded once; all other accounts come from the portal.
    for (const u of STAFF) {
      const exists = await db.get('SELECT id FROM users WHERE email = ?', u.email);
      if (!exists) {
        await db.run(`INSERT INTO users (role, full_name, email, password_hash, staff_no, must_change_password)
                      VALUES (?, ?, ?, ?, ?, 0)`,
          u.role, u.name, u.email, bcrypt.hashSync(u.pw, 12), u.staffNo);
        console.log(`Created ${u.role}: ${u.email}  (password from server/.env — change it after first sign-in)`);
      }
    }
  });
  await run();
}

module.exports = { seedMasterData };

/* CLI entry: node seed.js */
if (require.main === module) {
  require('dotenv').config();
  const { readyPromise } = require('./db');
  readyPromise()
    .then(() => seedMasterData())
    .then(() => { console.log('Seed complete: faculties, departments/units, service catalogue and staff accounts ready.'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
