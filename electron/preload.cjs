const { contextBridge, ipcRenderer } = require('electron');

// Explicit operations only: the page never receives ipcRenderer or Node access.
contextBridge.exposeInMainWorld('nestDesktop', Object.freeze({
  version: '1.0.0',
  getVersion: () => ipcRenderer.invoke('nest:version'),
  notify: (title, body) => ipcRenderer.invoke('nest:notify', title, body),
  getAutoLaunch: () => ipcRenderer.invoke('nest:get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('nest:set-auto-launch', enabled),
  showWindow: () => ipcRenderer.invoke('nest:show-window'),
  getAlwaysOnTop: () => ipcRenderer.invoke('nest:get-always-on-top'),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('nest:set-always-on-top', enabled),
  notes: Object.freeze({
    initialize: initialNotes => {
      const snapshot = ipcRenderer.sendSync('nest:notes-initialize', initialNotes);
      if (snapshot && snapshot.__nestError) throw new Error(snapshot.__nestError);
      return snapshot;
    },
    list: () => ipcRenderer.invoke('nest:notes-list'),
    mutate: request => ipcRenderer.invoke('nest:notes-mutate', request),
    onChanged: callback => {
      if (typeof callback !== 'function') throw new TypeError('notes.onChanged requires a callback');
      const listener = (_event, snapshot) => callback(snapshot);
      ipcRenderer.on('nest:notes-changed', listener);
      return () => ipcRenderer.removeListener('nest:notes-changed', listener);
    },
  }),
  openNote: id => ipcRenderer.invoke('nest:open-note', id),
  closeNote: () => ipcRenderer.invoke('nest:close-note'),
  getNoteAlwaysOnTop: () => ipcRenderer.invoke('nest:get-note-always-on-top'),
  setNoteAlwaysOnTop: enabled => ipcRenderer.invoke('nest:set-note-always-on-top', enabled),
  showMain: () => ipcRenderer.invoke('nest:show-main'),
}));
