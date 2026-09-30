import { contextBridge, ipcRenderer } from 'electron';
import type { Action } from '../../core/models';
const actions: Action[] = ['status', 'login', 'unlock', 'logout', 'categories', 'items', 'epg', 'detail', 'play', 'stop', 'library', 'saveLibrary', 'heartbeat', 'mediaStats'];
contextBridge.exposeInMainWorld('kiyi', { call: (action: Action, payload?: unknown) => actions.includes(action) ? ipcRenderer.invoke('kiyi:call', action, payload) : Promise.resolve({ ok: false, error: { code: 'METHOD', message: 'Geçersiz işlem.' } }) });
