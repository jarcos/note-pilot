// Spike B (standalone) — confirm better-sqlite3 works under Electron's Node ABI.
//
// Two-part check:
//   1) `npm run spike:sqlite` runs this in plain Node (sanity).
//   2) The REAL test is the in-app button (src/main/index.js): native modules
//      must match Electron's ABI, so run `npm run rebuild` then `npm start`
//      and click "Run SQLite smoke test". That's what proves packaging works.
//
// On Apple Silicon: after `npm install`, run `npm run rebuild` to recompile
// better-sqlite3 against Electron, otherwise you'll get a NODE_MODULE_VERSION error.

const Database = require('better-sqlite3');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE course  (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE lecture (id INTEGER PRIMARY KEY, course_id INTEGER, title TEXT,
                        lang TEXT, transcript TEXT, summary TEXT, notes TEXT);
`);

const addCourse = db.prepare('INSERT INTO course (name) VALUES (?)');
const courseId = addCourse.run('Historia de la música').lastInsertRowid;

db.prepare(`INSERT INTO lecture (course_id, title, lang, transcript)
            VALUES (?, ?, ?, ?)`)
  .run(courseId, 'Clase 5 — tercer trimestre', 'es', '(transcript goes here)');

const rows = db.prepare(`
  SELECT l.title, l.lang, c.name AS course
  FROM lecture l JOIN course c ON c.id = l.course_id
`).all();

console.log('better-sqlite3 version :', require('better-sqlite3/package.json').version);
console.log('sqlite engine version  :', db.prepare('SELECT sqlite_version() AS v').get().v);
console.log('rows                   :', JSON.stringify(rows, null, 2));
console.log('\nPASS — native SQLite read/write works in plain Node.');
console.log('Now verify in-app: npm run rebuild && npm start → click the button.');
db.close();
