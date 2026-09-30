'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bell, Check, CheckCheck, Download, Megaphone, RefreshCw, Sparkles, Trash2, Wrench, X } from 'lucide-react';
import Markdown from 'react-markdown';
import clientBrand from '@/branding/client.json';

type Notice = {
  id: string; heading: string; description: string; date: string; type: string;
  targetClient: string; updateAvailable: boolean; version?: string | null; buttonText: string; content: string;
};
type UpdateState = { status: string; version?: string; availableVersion?: string; progress?: number; error?: string };
type Toast = { notice: Notice; count: number; receivedAt: string } | { message: string; error?: boolean };
type Props = { clientId: string; userId: number };

function noticeTime(item: Notice) {
  const match = item.id.match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  const stamp = match ? Date.parse(match[1] + ':' + match[2] + ':' + match[3] + '.' + match[4] + 'Z') : Date.parse(item.date + 'T00:00:00');
  if (!Number.isFinite(stamp)) return item.date;
  const minutes = Math.floor((Date.now() - stamp) / 60_000);
  if (minutes >= 0 && minutes < 1) return 'Just now';
  if (minutes >= 1 && minutes < 60) return minutes + 'm ago';
  if (minutes >= 60 && minutes < 1_440) return Math.floor(minutes / 60) + 'h ago';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(stamp);
}

function NoticeGlyph({ item }: { item: Notice }) {
  const Icon = item.updateAvailable ? Download : item.type === 'feature' ? Sparkles : item.type === 'bugfix' ? Wrench : item.type === 'announcement' ? Megaphone : Bell;
  const tone = item.updateAvailable ? 'update' : item.type === 'feature' ? 'feature' : item.type === 'bugfix' ? 'bugfix' : 'general';
  return <span className={'notification-glyph notification-glyph--' + tone}><Icon size={17} strokeWidth={2} /></span>;
}

function newestFirst(notices: Notice[]) {
  return [...notices].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

export default function NotificationCenter({ clientId, userId }: Props) {
  const [items, setItems] = useState<Notice[]>([]);
  const [readIds, setReadIds] = useState<string[]>([]);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Notice | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(false);
  const [viewAll, setViewAll] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'unread'>('all');
  const [selected, setSelected] = useState<Notice | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ status: 'unavailable' });
  const knownIds = useRef<Set<string> | null>(null);
  const refreshBusy = useRef(false);
  const storageKey = 'pos-notification-read:' + clientId + ':' + userId;
  const hiddenStorageKey = 'pos-notification-hidden:' + clientId + ':' + userId;
  const readSet = new Set(readIds);
  const hiddenSet = new Set(hiddenIds);
  const visibleItems = items.filter(item => !hiddenSet.has(item.id));
  const unreadCount = visibleItems.filter(item => !readSet.has(item.id)).length;

  useEffect(() => {
    let active = true;
    const loadReadState = async () => {
      let stored: string[] = [];
      try {
        const local = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
        if (Array.isArray(local)) stored = local.filter(value => typeof value === 'string');
      } catch { /* Read state stays in memory. */ }
      try {
        const desktop = await window.posDesktop?.notificationReadIds?.(userId);
        if (Array.isArray(desktop)) stored = [...new Set([...stored, ...desktop])];
      } catch { /* The local copy is still usable. */ }
      let hidden: string[] = [];
      try {
        const local = JSON.parse(window.localStorage.getItem(hiddenStorageKey) || '[]');
        if (Array.isArray(local)) hidden = local.filter(value => typeof value === 'string');
      } catch { /* Hidden state stays in memory. */ }
      try {
        const desktop = await window.posDesktop?.notificationHiddenIds?.(userId);
        if (Array.isArray(desktop)) hidden = [...new Set([...hidden, ...desktop])];
      } catch { /* The local copy is still usable. */ }
      if (active) { setReadIds(stored); setHiddenIds(hidden); setStorageReady(true); }
    };
    loadReadState();
    return () => { active = false; };
  }, [storageKey, hiddenStorageKey, userId]);

  useEffect(() => {
    if (!storageReady) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(readIds)); }
    catch { /* Read state stays in memory. */ }
    window.posDesktop?.saveNotificationReadIds?.(userId, readIds).catch(() => {});
  }, [readIds, storageKey, storageReady, userId]);
  useEffect(() => {
    if (!storageReady) return;
    try { window.localStorage.setItem(hiddenStorageKey, JSON.stringify(hiddenIds)); }
    catch { /* Hidden state stays in memory. */ }
    window.posDesktop?.saveNotificationHiddenIds?.(userId, hiddenIds).catch(() => {});
  }, [hiddenIds, hiddenStorageKey, storageReady, userId]);

  useEffect(() => {
    let active = true;
    const loadSaved = async () => {
      try {
        const payload = window.posDesktop?.notifications
          ? await window.posDesktop.notifications(false) as Notice[]
          : (await fetch('./notifications.json').then(response => response.json()) as { notifications: Notice[] }).notifications;
        if (!active) return;
        const notices = Array.isArray(payload) ? newestFirst(payload) : [];
        knownIds.current = new Set(notices.map(item => item.id));
        setItems(notices);
      } catch { /* The user can try Refresh. */ }
      finally { if (active) setLoaded(true); }
    };
    loadSaved();
    window.posDesktop?.updateState?.().then(state => { if (active) setUpdate(state as UpdateState); }).catch(() => {});
    const unsubscribe = window.posDesktop?.onUpdateState?.(state => { if (active) setUpdate(state as UpdateState); });
    return () => { active = false; unsubscribe?.(); };
  }, [clientId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const refreshNotices = async () => {
    if (refreshBusy.current || !loaded) return;
    refreshBusy.current = true;
    setRefreshing(true);
    try {
      let notices: Notice[];
      if (window.posDesktop?.notifications) {
        notices = await window.posDesktop.notifications(true) as Notice[];
      } else {
        const feedUrl = clientBrand.notificationFeedUrl || './notifications.json';
        const headers = feedUrl.startsWith('https://api.github.com/') ? { Accept: 'application/vnd.github.raw+json' } : undefined;
        const response = await fetch(feedUrl, { headers, cache: 'no-store' });
        if (!response.ok) throw new Error('Notification feed returned ' + response.status);
        const payload = await response.json() as { clientId: string; notifications: Notice[] };
        if (payload.clientId !== clientId) throw new Error('Notification feed belongs to another client');
        notices = payload.notifications;
      }
      if (!Array.isArray(notices)) throw new Error('Invalid notification feed');
      const sorted = newestFirst(notices);
      const incoming = sorted.filter(item => !knownIds.current?.has(item.id) && !hiddenSet.has(item.id));
      knownIds.current = new Set(sorted.map(item => item.id));
      setItems(sorted);
      setToast(incoming.length ? { notice: incoming[0], count: incoming.length, receivedAt: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date()) } : { message: 'Notifications are up to date.' });
    } catch {
      setToast({ message: 'Could not refresh. Saved notifications are still available.', error: true });
    } finally {
      refreshBusy.current = false;
      setRefreshing(false);
    }
  };

  const markRead = (id: string) => setReadIds(current => current.includes(id) ? current : [...current, id]);
  const markAllRead = () => setReadIds(current => [...new Set([...current, ...visibleItems.map(item => item.id)])]);
  const openNotice = (item: Notice) => { markRead(item.id); setSelected(item); setViewAll(true); setOpen(false); setToast(null); };
  const deleteNotice = () => {
    if (!deleteTarget) return;
    setHiddenIds(current => current.includes(deleteTarget.id) ? current : [...current, deleteTarget.id]);
    if (selected?.id === deleteTarget.id) setSelected(null);
    if (toast && 'notice' in toast && toast.notice.id === deleteTarget.id) setToast(null);
    setDeleteTarget(null);
  };
  const closeModal = () => { setSelected(null); setViewAll(false); };
  const startUpdate = async () => {
    if (!window.posDesktop?.startUpdate) return;
    try { setUpdate(current => ({ ...current, status: 'checking', error: '' })); await window.posDesktop.startUpdate(); }
    catch (error) { setUpdate(current => ({ ...current, status: 'error', error: error instanceof Error ? error.message : 'Update failed' })); }
  };
  const installUpdate = async () => {
    try { await window.posDesktop?.installUpdate?.(); }
    catch (error) { setUpdate(current => ({ ...current, status: 'error', error: error instanceof Error ? error.message : 'Installation failed' })); }
  };
  const updateLabel = update.status === 'downloaded' ? 'Restart & Update' : update.status === 'downloading' ? 'Downloading… ' + (update.progress || 0) + '%' : update.status === 'checking' ? 'Checking for update…' : selected?.buttonText || 'Update Now';
  const updateBusy = ['checking', 'downloading', 'installing'].includes(update.status);
  const desktopAvailable = typeof window !== 'undefined' && Boolean(window.posDesktop?.startUpdate);
  const newerThanInstalled = (target?: string | null) => {
    if (!target || !update.version) return true;
    const targetParts = target.split('.').map(Number);
    const installedParts = update.version.split('.').map(Number);
    for (let index = 0; index < 3; index += 1) {
      if (targetParts[index] !== installedParts[index]) return targetParts[index] > installedParts[index];
    }
    return false;
  };
  const history = historyFilter === 'unread' ? visibleItems.filter(item => !readSet.has(item.id)) : visibleItems;

  return <div className="notification-center">
    <button className="notification-refresh" aria-label="Refresh notifications" title="Refresh notifications" disabled={!loaded || refreshing} onClick={refreshNotices}><RefreshCw size={18} className={refreshing ? 'is-spinning' : ''} /></button>
    <button className="notification-trigger" aria-label={'Notifications, ' + unreadCount + ' unread'} aria-expanded={open} title="Notifications" onClick={() => setOpen(value => !value)}><Bell size={19} />{unreadCount > 0 && <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>
    {open && <><button className="notification-dismiss" aria-label="Close notifications" onClick={() => setOpen(false)} /><div className="notification-dropdown">
      <div className="notification-dropdown-head"><div><strong>Notifications</strong><span>{unreadCount ? unreadCount + ' unread' : 'You are all caught up'}</span></div>{unreadCount > 0 && <button onClick={markAllRead}><CheckCheck size={15} /> Mark all read</button>}</div>
      <div className="notification-dropdown-list">{visibleItems.slice(0, 5).map(item => <div className="notification-entry" key={item.id}><button className={'notification-row ' + (readSet.has(item.id) ? 'is-read' : 'is-unread')} onClick={() => openNotice(item)}><NoticeGlyph item={item} /><span className="notification-row-copy"><span className="notification-row-top"><strong>{item.heading}</strong><small>{noticeTime(item)}</small></span><span className="notification-row-description">{item.description}</span><span className="notification-row-type">{item.updateAvailable ? 'Software update' : item.type}</span></span>{!readSet.has(item.id) && <i className="notification-unread-dot" />}</button><button className="notification-delete" title={`Delete ${item.heading}`} aria-label={`Delete ${item.heading}`} onClick={() => setDeleteTarget(item)}><Trash2 size={15} /></button></div>)}
        {visibleItems.length === 0 && <div className="notification-empty"><Bell size={22} /><strong>No notifications yet</strong><span>Use refresh to check for new messages.</span></div>}</div>
      <button className="notification-view-all" onClick={() => { setViewAll(true); setSelected(null); setOpen(false); }}>View All Notifications <ArrowRight size={16} /></button>
    </div></>}
    {(selected || viewAll) && <div className="notification-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeModal(); }}><section className="notification-modal" role="dialog" aria-modal="true" aria-label={selected?.heading || 'All notifications'}>
      <header className="notification-modal-head"><div className="notification-modal-title"><span className="notification-modal-symbol"><Bell size={19} /></span><div><h2>{selected?.heading || 'All Notifications'}</h2><p>{selected ? noticeTime(selected) + ' · ' + (selected.updateAvailable ? 'Software update' : selected.type) : 'Messages and updates for your business'}</p></div></div><button className="notification-close" aria-label="Close" onClick={closeModal}><X size={19} /></button></header>
      {selected ? <div className="notification-detail"><div className="notification-detail-summary"><NoticeGlyph item={selected} /><div><span>{selected.updateAvailable ? 'Software update' : selected.type}</span><h3>{selected.heading}</h3><p>{selected.description}</p></div></div><div className="notification-markdown"><Markdown>{selected.content}</Markdown></div>{selected.updateAvailable && newerThanInstalled(selected.version) && <div className="notification-update"><div><strong>Update available</strong><small>Installed version: {update.version || 'Unknown'}{update.availableVersion ? ' · Available: ' + update.availableVersion : ''}</small></div><button className="primary-button" disabled={!desktopAvailable || update.status === 'unavailable' || updateBusy} onClick={update.status === 'downloaded' ? installUpdate : startUpdate}>{update.status === 'downloaded' ? <RefreshCw size={15} /> : <Download size={15} />}{updateLabel}</button>{update.status === 'downloading' && <div className="notification-progress"><i style={{ width: (update.progress || 0) + '%' }} /></div>}{update.status === 'current' && <small>Application is already up to date.</small>}{update.status === 'error' && <small className="notification-error">{update.error}</small>}{(!desktopAvailable || update.status === 'unavailable') && <small>Update downloads are not configured for this installation.</small>}</div>}</div>
        : <><div className="notification-history-tools"><div className="notification-tabs"><button className={historyFilter === 'all' ? 'active' : ''} onClick={() => setHistoryFilter('all')}>All <span>{visibleItems.length}</span></button><button className={historyFilter === 'unread' ? 'active' : ''} onClick={() => setHistoryFilter('unread')}>Unread <span>{unreadCount}</span></button></div>{unreadCount > 0 && <button className="notification-mark-all" onClick={markAllRead}><CheckCheck size={15} /> Mark all as read</button>}</div><div className="notification-history">{history.map(item => <div className="notification-history-entry" key={item.id}><button className={'notification-history-row ' + (readSet.has(item.id) ? 'is-read' : 'is-unread')} onClick={() => openNotice(item)}><NoticeGlyph item={item} /><span className="notification-history-copy"><span className="notification-row-top"><strong>{item.heading}</strong><small>{noticeTime(item)}</small></span><span>{item.description}</span><em>{item.updateAvailable ? 'Software update' : item.type}</em></span>{readSet.has(item.id) ? <Check className="notification-history-check" size={16} /> : <i className="notification-unread-dot" />}</button><button className="notification-delete" title={`Delete ${item.heading}`} aria-label={`Delete ${item.heading}`} onClick={() => setDeleteTarget(item)}><Trash2 size={16} /></button></div>)}{history.length === 0 && <div className="notification-empty"><CheckCheck size={22} /><strong>{historyFilter === 'unread' ? 'Nothing unread' : 'No notifications yet'}</strong><span>{historyFilter === 'unread' ? 'You have opened all your messages.' : 'Refresh to check for new messages.'}</span></div>}</div></>}
      {selected && <footer className="notification-modal-footer"><button onClick={() => setSelected(null)}><ArrowRight size={15} /> Back to all notifications</button><button className="notification-delete-detail" onClick={() => setDeleteTarget(selected)}><Trash2 size={15} /> Delete notification</button></footer>}
    </section></div>}
    {deleteTarget && <div className="notification-confirm-backdrop"><div className="notification-confirm" role="dialog" aria-modal="true" aria-label="Delete notification"><span className="notification-confirm-icon"><Trash2 size={20} /></span><h2>Delete notification?</h2><p>{deleteTarget.heading} will be removed from your notification list on this device.</p><div><button onClick={() => setDeleteTarget(null)}>No, keep it</button><button onClick={deleteNotice}>Yes, delete</button></div></div></div>}
    {toast && <div className={'notification-toast ' + ('message' in toast ? 'notification-toast--status' + (toast.error ? ' notification-toast--error' : '') : '')} role="status" aria-live="polite">{'notice' in toast ? <><NoticeGlyph item={toast.notice} /><div className="notification-toast-copy"><small>New notification · Received {toast.receivedAt}{toast.count > 1 ? ' · +' + (toast.count - 1) + ' more' : ''}</small><strong>{toast.notice.heading}</strong><span>{toast.notice.description}</span><div className="notification-toast-actions"><button onClick={() => openNotice(toast.notice)}>View Details <ArrowRight size={14} /></button>{toast.notice.updateAvailable && newerThanInstalled(toast.notice.version) && desktopAvailable && update.status !== 'unavailable' && <button onClick={() => { setToast(null); openNotice(toast.notice); startUpdate(); }}><Download size={14} /> Update now</button>}</div></div></> : <>{toast.error ? <X size={19} /> : <Check size={19} />}<span>{toast.message}</span></>}<button className="notification-toast-close" aria-label="Dismiss alert" onClick={() => setToast(null)}><X size={16} /></button></div>}
  </div>;
}
