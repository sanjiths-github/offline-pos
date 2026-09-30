'use client';

import { useEffect, useState } from 'react';
import { Bell, Download, RefreshCw, X } from 'lucide-react';
import Markdown from 'react-markdown';

type Notice = {
  id: string; heading: string; description: string; date: string; type: string;
  targetClient: string; updateAvailable: boolean; buttonText: string; content: string;
};
type UpdateState = { status: string; version?: string; availableVersion?: string; progress?: number; error?: string };

export default function NotificationCenter() {
  const [items, setItems] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const [viewAll, setViewAll] = useState(false);
  const [selected, setSelected] = useState<Notice | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ status: 'unavailable' });

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const notices = window.posDesktop?.notifications
          ? await window.posDesktop.notifications() as Notice[]
          : ((await fetch('./notifications.json').then(response => response.json())) as { notifications: Notice[] }).notifications;
        if (mounted) setItems(Array.isArray(notices) ? notices.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)) : []);
      } catch { if (mounted) setItems([]); }
    };
    load();
    window.posDesktop?.updateState?.().then(state => { if (mounted) setUpdate(state as UpdateState); }).catch(() => {});
    const unsubscribe = window.posDesktop?.onUpdateState?.(state => { if (mounted) setUpdate(state as UpdateState); });
    const timer = window.setInterval(load, 300_000);
    return () => { mounted = false; window.clearInterval(timer); unsubscribe?.(); };
  }, []);

  const startUpdate = async () => {
    if (!window.posDesktop?.startUpdate) return;
    try { setUpdate(current => ({ ...current, status: 'checking', error: '' })); await window.posDesktop.startUpdate(); }
    catch (error) { setUpdate(current => ({ ...current, status: 'error', error: error instanceof Error ? error.message : 'Update failed' })); }
  };
  const installUpdate = async () => {
    try { await window.posDesktop?.installUpdate?.(); }
    catch (error) { setUpdate(current => ({ ...current, status: 'error', error: error instanceof Error ? error.message : 'Installation failed' })); }
  };
  const updateLabel = update.status === 'downloaded' ? 'Restart & Update' : update.status === 'downloading' ? `Downloading… ${update.progress || 0}%` : update.status === 'checking' ? 'Checking for update…' : selected?.buttonText || 'Update Now';
  const updateBusy = ['checking', 'downloading', 'installing'].includes(update.status);
  const desktopAvailable = typeof window !== 'undefined' && Boolean(window.posDesktop?.startUpdate);

  return <div className="notification-center">
    <button className="notification-trigger" aria-label="Notifications" aria-expanded={open} onClick={() => setOpen(value => !value)}><Bell size={19} />{items.length > 0 && <i />}</button>
    {open && <><button className="notification-dismiss" aria-label="Close notifications" onClick={() => setOpen(false)} /><div className="notification-dropdown">
      <div className="notification-dropdown-head"><strong>Notifications</strong><span>{items.length}</span></div>
      {items.slice(0, 5).map(item => <button className="notification-row" key={item.id} onClick={() => { setSelected(item); setOpen(false); setViewAll(false); }}><strong>{item.heading}</strong><span>{item.description}</span><small>{item.date}</small></button>)}
      {items.length === 0 && <p className="notification-empty">No notifications yet.</p>}
      <button className="notification-view-all" onClick={() => { setViewAll(true); setOpen(false); }}>View All Notifications</button>
    </div></>}
    {(selected || viewAll) && <div className="notification-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) { setSelected(null); setViewAll(false); } }}><section className="notification-modal" role="dialog" aria-modal="true" aria-label={selected?.heading || 'All notifications'}>
      <header><div><h2>{selected?.heading || 'All notifications'}</h2>{selected && <p>{selected.date} · {selected.type}</p>}</div><button aria-label="Close" onClick={() => { setSelected(null); setViewAll(false); }}><X size={19} /></button></header>
      {selected ? <div className="notification-detail"><p className="notification-description">{selected.description}</p><div className="notification-markdown"><Markdown>{selected.content}</Markdown></div>{selected.updateAvailable && <div className="notification-update"><small>Installed version: {update.version || 'Unknown'}{update.availableVersion ? ` · Available: ${update.availableVersion}` : ''}</small><button className="primary-button" disabled={!desktopAvailable || update.status === 'unavailable' || updateBusy} onClick={update.status === 'downloaded' ? installUpdate : startUpdate}>{update.status === 'downloaded' ? <RefreshCw size={15} /> : <Download size={15} />}{updateLabel}</button>{update.status === 'downloading' && <div className="notification-progress"><i style={{ width: `${update.progress || 0}%` }} /></div>}{update.status === 'current' && <small>Application is already up to date.</small>}{update.status === 'error' && <small className="notification-error">{update.error}</small>}{(!desktopAvailable || update.status === 'unavailable') && <small>Update downloads are not configured for this installation.</small>}</div>}</div>
        : <div className="notification-history">{items.map(item => <button key={item.id} onClick={() => setSelected(item)}><strong>{item.heading}</strong><span>{item.description}</span><small>{item.date} · {item.type}</small></button>)}{items.length === 0 && <p className="notification-empty">No notifications yet.</p>}</div>}
      {selected && <footer><button onClick={() => { setSelected(null); setViewAll(true); }}>Back to all notifications</button></footer>}
    </section></div>}
  </div>;
}
