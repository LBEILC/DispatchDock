import { contextBridge, ipcRenderer } from 'electron';
import type { API, Snapshot } from '../shared/types';
const api: API = { preferences: async (action, payload) => {
    const result = await ipcRenderer.invoke('preferences', action, payload);
    if (!result.ok) throw Error(result.error);
    return result.value;
}, snapshot: () => ipcRenderer.invoke('snapshot'), detail: id => ipcRenderer.invoke('detail', id), events: (id, cursor, before) => ipcRenderer.invoke('events', id, cursor, before), action: (id, action, value) => ipcRenderer.invoke('action', id, action, value), import: () => ipcRenderer.invoke('import'), subscribe(callback) { const listener = (_event: unknown, s: Snapshot) => callback(s); ipcRenderer.on('snapshot', listener); return () => ipcRenderer.removeListener('snapshot', listener); } };
contextBridge.exposeInMainWorld('dock', api);
