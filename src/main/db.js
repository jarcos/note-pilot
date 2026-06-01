// SQLite persistence (better-sqlite3). Synchronous API — fine for a desktop app.
const Database = require('better-sqlite3');
const { dirs } = require('./paths');

let db = null;

const SCHEMA = `
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS course (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lecture (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id   INTEGER NOT NULL REFERENCES course(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    lang        TEXT,
    audio_path  TEXT,
    duration_sec REAL,
    transcript  TEXT,        -- full plain text
    summary     TEXT,        -- generated later (M3)
    notes       TEXT,        -- generated later (M3)
    created_at  INTEGER NOT NULL
  );

  -- One row per timestamped segment, so we can anchor notes to the audio later.
  CREATE TABLE IF NOT EXISTS segment (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    lecture_id INTEGER NOT NULL REFERENCES lecture(id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,
    from_ms    INTEGER,
    to_ms      INTEGER,
    text       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_segment_lecture ON segment(lecture_id, seq);
`;

function init() {
  if (db) return db;
  db = new Database(dirs.db());
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

function getOrCreateCourse(name) {
  init();
  const existing = db.prepare('SELECT id FROM course WHERE name = ?').get(name);
  if (existing) return existing.id;
  return db.prepare('INSERT INTO course (name, created_at) VALUES (?, ?)')
    .run(name, Date.now()).lastInsertRowid;
}

/**
 * Persist a transcribed lecture + its segments in one transaction.
 * @returns {number} new lecture id
 */
function saveLecture({ courseName = 'Uncategorized', title, lang, audioPath, durationSec, segments }) {
  init();
  const courseId = getOrCreateCourse(courseName);
  const text = segments.map((s) => s.text).join(' ');

  const tx = db.transaction(() => {
    const lectureId = db.prepare(`
      INSERT INTO lecture (course_id, title, lang, audio_path, duration_sec, transcript, created_at)
      VALUES (@courseId, @title, @lang, @audioPath, @durationSec, @transcript, @createdAt)
    `).run({
      courseId, title, lang: lang || null, audioPath: audioPath || null,
      durationSec: durationSec ?? null, transcript: text, createdAt: Date.now(),
    }).lastInsertRowid;

    const insSeg = db.prepare(`
      INSERT INTO segment (lecture_id, seq, from_ms, to_ms, text)
      VALUES (?, ?, ?, ?, ?)
    `);
    segments.forEach((s, i) => insSeg.run(lectureId, i, s.fromMs ?? null, s.toMs ?? null, s.text));
    return lectureId;
  });
  return tx();
}

function listLectures() {
  init();
  return db.prepare(`
    SELECT l.id, l.title, l.lang, l.duration_sec AS durationSec,
           c.id AS courseId, c.name AS course, l.created_at AS createdAt
    FROM lecture l JOIN course c ON c.id = l.course_id
    ORDER BY l.created_at DESC
  `).all();
}

function getLecture(id) {
  init();
  const lecture = db.prepare('SELECT * FROM lecture WHERE id = ?').get(id);
  if (!lecture) return null;
  lecture.segments = db.prepare(
    'SELECT seq, from_ms AS fromMs, to_ms AS toMs, text FROM segment WHERE lecture_id = ? ORDER BY seq'
  ).all(id);
  return lecture;
}

// --- Course management ---

const UNCATEGORIZED = 'Uncategorized';

function listCourses() {
  init();
  return db.prepare(`
    SELECT c.id, c.name, COUNT(l.id) AS lectureCount
    FROM course c LEFT JOIN lecture l ON l.course_id = c.id
    GROUP BY c.id
    ORDER BY (c.name = ?) DESC, c.name COLLATE NOCASE ASC
  `).all(UNCATEGORIZED);
}

function createCourse(name) {
  init();
  const clean = (name || '').trim();
  if (!clean) throw new Error('Course name cannot be empty.');
  const existing = db.prepare('SELECT id FROM course WHERE name = ? COLLATE NOCASE').get(clean);
  if (existing) return existing.id;
  return db.prepare('INSERT INTO course (name, created_at) VALUES (?, ?)')
    .run(clean, Date.now()).lastInsertRowid;
}

function renameCourse(id, name) {
  init();
  const clean = (name || '').trim();
  if (!clean) throw new Error('Course name cannot be empty.');
  const cur = db.prepare('SELECT name FROM course WHERE id = ?').get(id);
  if (cur && cur.name === UNCATEGORIZED) throw new Error('Cannot rename the Uncategorized course.');
  db.prepare('UPDATE course SET name = ? WHERE id = ?').run(clean, id);
  return true;
}

// Deleting a course moves its lectures to Uncategorized (never destroys lectures).
function deleteCourse(id) {
  init();
  const cur = db.prepare('SELECT name FROM course WHERE id = ?').get(id);
  if (!cur) return false;
  if (cur.name === UNCATEGORIZED) throw new Error('Cannot delete the Uncategorized course.');
  const uncatId = getOrCreateCourse(UNCATEGORIZED);
  const tx = db.transaction(() => {
    db.prepare('UPDATE lecture SET course_id = ? WHERE course_id = ?').run(uncatId, id);
    db.prepare('DELETE FROM course WHERE id = ?').run(id);
  });
  tx();
  return true;
}

// --- Lecture management ---

function renameLecture(id, title) {
  init();
  const clean = (title || '').trim();
  if (!clean) throw new Error('Title cannot be empty.');
  db.prepare('UPDATE lecture SET title = ? WHERE id = ?').run(clean, id);
  return true;
}

function moveLecture(lectureId, courseId) {
  init();
  db.prepare('UPDATE lecture SET course_id = ? WHERE id = ?').run(courseId, lectureId);
  return true;
}

// Persist generated Markdown ('summary' or 'notes') for a lecture.
function saveGeneration(lectureId, type, markdown) {
  init();
  if (type !== 'summary' && type !== 'notes') throw new Error(`Invalid generation type: ${type}`);
  db.prepare(`UPDATE lecture SET ${type} = ? WHERE id = ?`).run(markdown, lectureId);
  return true;
}

// Returns the stored audio path so the caller can delete the file on disk.
function deleteLecture(id) {
  init();
  const row = db.prepare('SELECT audio_path AS audioPath FROM lecture WHERE id = ?').get(id);
  db.prepare('DELETE FROM lecture WHERE id = ?').run(id); // segments cascade
  return row ? row.audioPath : null;
}

module.exports = {
  init, getOrCreateCourse, saveLecture, listLectures, getLecture,
  listCourses, createCourse, renameCourse, deleteCourse,
  renameLecture, moveLecture, deleteLecture, saveGeneration, UNCATEGORIZED,
};
