// Preload — safe API bridge (contextIsolation on).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('notePilot', {
  // resolve absolute path of a drag-dropped File (Electron 30+)
  pathForFile: (file) => webUtils.getPathForFile(file),

  // model
  modelStatus: () => ipcRenderer.invoke('model:status'),
  downloadModel: () => ipcRenderer.invoke('model:download'),

  // pipeline
  pickAudio: () => ipcRenderer.invoke('dialog:pickAudio'),
  transcribeFile: (opts) => ipcRenderer.invoke('transcribe:file', opts),

  // library
  listLectures: () => ipcRenderer.invoke('library:list'),
  getLecture: (id) => ipcRenderer.invoke('lecture:get', id),

  // courses
  listCourses: () => ipcRenderer.invoke('courses:list'),
  createCourse: (name) => ipcRenderer.invoke('course:create', name),
  renameCourse: (id, name) => ipcRenderer.invoke('course:rename', { id, name }),
  deleteCourse: (id) => ipcRenderer.invoke('course:delete', id),

  // lecture lifecycle
  renameLecture: (id, title) => ipcRenderer.invoke('lecture:rename', { id, title }),
  moveLecture: (id, courseId) => ipcRenderer.invoke('lecture:move', { id, courseId }),
  deleteLecture: (id) => ipcRenderer.invoke('lecture:delete', id),

  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setApiKey: (key) => ipcRenderer.invoke('settings:setKey', key),

  // export
  exportDoc: (lectureId, kind, format) => ipcRenderer.invoke('export:run', { lectureId, kind, format }),

  // generation
  generate: (lectureId, type) => ipcRenderer.invoke('generate:run', { lectureId, type }),
  onGenerateProgress: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('generate:progress', h);
    return () => ipcRenderer.removeListener('generate:progress', h);
  },

  // progress events
  onTranscribeProgress: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('transcribe:progress', h);
    return () => ipcRenderer.removeListener('transcribe:progress', h);
  },
  onModelProgress: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('model:progress', h);
    return () => ipcRenderer.removeListener('model:progress', h);
  },
});
