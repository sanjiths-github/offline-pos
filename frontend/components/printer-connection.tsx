'use client';
import { useEffect, useState } from 'react';
import { Bluetooth, Cable, CircleCheck, PlugZap, Printer, RefreshCw, Unplug } from 'lucide-react';
import { api } from '@/lib/api';

type Device = { name: string; portName: string; driverName: string; status: string; connectionType: 'USB' | 'BLUETOOTH' | 'SYSTEM'; connected: boolean };
type Setting = { id: number; name: string; device_identifier: string; connection_type: string; receipt_width: number; is_active: number };
type Nearby = { id: string; name: string };

export default function PrinterConnection({ token, canEdit, onChange }: { token: string; canEdit: boolean; onChange: () => void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [nearby, setNearby] = useState<Nearby[]>([]);
  const [selected, setSelected] = useState('');
  const [width, setWidth] = useState<58 | 80>(80);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const active = settings.find(item => item.is_active);
  const activeDevice = devices.find(device => device.name === (active?.device_identifier || active?.name));
  async function refresh() {
    setError('');
    try {
      const [installed, configured] = await Promise.all([api<Device[]>('/printer/devices','GET',undefined,token),api<Setting[]>('/printer','GET',undefined,token)]);
      setDevices(installed); setSettings(configured);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not find printers'); }
  }
  useEffect(() => { refresh(); }, [token]);
  useEffect(() => {
    const unsubscribe = window.posDesktop?.onBluetoothDevices?.(found => setNearby(found));
    return () => { unsubscribe?.(); };
  }, []);
  async function connect() {
    if (!selected) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api('/printer/connect','POST',{ name: selected, receiptWidth: width },token);
      await refresh(); onChange(); setMessage('Printer connected for POS receipts.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not connect'); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setError(''); setMessage('');
    try { await api('/printer/disconnect','POST',{},token); await refresh(); onChange(); setMessage('Printer disconnected from POS.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not disconnect'); }
    finally { setBusy(false); }
  }
  async function testPrint() {
    setBusy(true); setError(''); setMessage('');
    try { await api('/printer/test','POST',{},token); setMessage('Test page sent to the printer.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Test print failed'); }
    finally { setBusy(false); }
  }
  async function scanBluetooth() {
    setNearby([]); setScanning(true); setError(''); setMessage('Scanning for nearby Bluetooth devices…');
    try {
      if (!window.posDesktop?.onBluetoothDevices) throw new Error('Nearby scanning is available in the desktop app.');
      const bluetooth = (navigator as Navigator & { bluetooth?: { requestDevice: (options: { acceptAllDevices: boolean }) => Promise<{ name?: string }> } }).bluetooth;
      if (!bluetooth) throw new Error('Bluetooth is unavailable on this computer.');
      await bluetooth.requestDevice({ acceptAllDevices: true });
      setMessage('Device selected. Add it as a printer in your operating system, then refresh the installed printers.');
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : 'Bluetooth scan ended';
      if (!/cancel|user cancelled|no device/i.test(text)) setError(text);
    } finally { setScanning(false); }
  }
  async function selectBluetooth(device: Nearby) {
    try { await window.posDesktop?.selectBluetoothDevice?.(device.id); setMessage(`${device.name} selected. Pair or install it as a system printer, then refresh.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not select device'); }
  }
  return <div className="clean-printer-page">
    <div className="clean-page-heading"><div><h2>Printer Connection</h2><p>Select a receipt printer installed on this computer.</p></div><button className="secondary-button" onClick={refresh}><RefreshCw size={16} /> Refresh</button></div>
    <div className="clean-printer-grid">
      <section className="clean-panel"><div className="clean-panel-header"><h3>Current printer</h3></div>{active ? <div className="clean-current-printer"><span className="clean-printer-icon"><Printer size={25} /></span><div><strong>{active.name}</strong><small>{active.connection_type === 'BLUETOOTH' ? 'Bluetooth' : active.connection_type === 'USB' ? 'Cable / USB' : 'System printer'} · {activeDevice?.portName || 'Installed queue'}</small><span className={activeDevice?.connected ? 'clean-connected' : 'clean-disconnected'}>{activeDevice?.status || 'Status unavailable'}</span></div></div> : <div className="clean-empty">No printer selected. Sales can still be completed without a receipt.</div>}<div className="clean-printer-actions"><button className="secondary-button" disabled={!active || busy} onClick={testPrint}><Printer size={16} /> Test Print</button>{canEdit && <button className="secondary-button" disabled={!active || busy} onClick={disconnect}><Unplug size={16} /> Disconnect</button>}</div></section>
      <section className="clean-panel"><div className="clean-panel-header"><h3>Installed printers</h3><span>{devices.length} found</span></div><p className="clean-panel-note">Connect a cable printer or pair a Bluetooth printer in your operating system first. The printer must appear here before receipts can be sent to it.</p><div className="clean-device-list">{devices.map(device => <label className={`clean-device ${selected===device.name?'selected':''}`} key={device.name}><input type="radio" name="printer" checked={selected===device.name} onChange={() => setSelected(device.name)} /><span className="clean-device-icon">{device.connectionType==='BLUETOOTH'?<Bluetooth size={20}/>:<Cable size={20}/>}</span><span><strong>{device.name}</strong><small>{device.driverName} · {device.portName || 'No port'}</small></span><em className={device.connected?'clean-connected':'clean-disconnected'}>{device.status}</em></label>)}{!devices.length && <div className="clean-empty">No system printers found.</div>}</div>{canEdit && <div className="clean-connect-row"><label>Paper width <select value={width} onChange={event => setWidth(Number(event.target.value) as 58 | 80)}><option value={80}>80 mm</option><option value={58}>58 mm</option></select></label><button className="primary-button" disabled={!selected || busy} onClick={connect}><PlugZap size={16} /> Connect</button></div>}</section>
      <section className="clean-panel clean-bluetooth-panel"><div className="clean-panel-header"><h3>Nearby Bluetooth</h3><Bluetooth size={19} /></div><p className="clean-panel-note">Scan for discoverable Bluetooth LE devices. Classic Bluetooth receipt printers may only appear after pairing in your operating system. A device can print receipts once it has an installed printer queue.</p><div className="clean-printer-actions"><button className="secondary-button" disabled={scanning} onClick={scanBluetooth}><Bluetooth size={16} /> {scanning ? 'Scanning…' : 'Scan nearby'}</button><button className="secondary-button" onClick={() => window.posDesktop?.openBluetoothSettings?.().catch(cause => setError(cause instanceof Error ? cause.message : 'Could not open Bluetooth settings'))}>Open Bluetooth settings</button></div>{nearby.length > 0 && <div className="clean-device-list">{nearby.map(device => <button className="clean-device clean-nearby" key={device.id} onClick={() => selectBluetooth(device)}><Bluetooth size={18} /><span><strong>{device.name}</strong><small>Select device</small></span></button>)}</div>}</section>
    </div>
    {message && <p className="clean-info"><CircleCheck size={16} /> {message}</p>}{error && <p className="form-error">{error}</p>}
  </div>;
}
