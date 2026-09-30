import type { Session } from './types';

declare global {
  interface Window { posDesktop?: { request: (path: string, method?: string, body?: unknown, token?: string) => Promise<unknown>; platform: string; onBluetoothDevices?: (callback: (devices: { id: string; name: string }[]) => void) => () => void; selectBluetoothDevice?: (id: string) => Promise<unknown>; cancelBluetoothScan?: () => Promise<unknown>; openBluetoothSettings?: () => Promise<unknown>; notifications?: (refresh?: boolean) => Promise<unknown>; notificationReadIds?: (userId: number) => Promise<string[]>; saveNotificationReadIds?: (userId: number, ids: string[]) => Promise<unknown>; updateState?: () => Promise<unknown>; startUpdate?: () => Promise<unknown>; installUpdate?: () => Promise<unknown>; onUpdateState?: (callback: (state: unknown) => void) => () => void } }
}

export async function api<T>(path: string, method = 'GET', body?: unknown, token?: string): Promise<T> {
  if (typeof window !== 'undefined' && window.posDesktop) return window.posDesktop.request(path, method, body, token) as Promise<T>;
  const response = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const logIn = (username: string, password: string) => api<Session>('/auth/login', 'POST', { username, password });
export const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
