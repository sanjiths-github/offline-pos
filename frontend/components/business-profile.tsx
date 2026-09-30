'use client';
import { useEffect, useState } from 'react';
import { Building2, Clock3, MapPin, Phone, Save, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import type { BusinessHour, BusinessProfile } from '@/lib/types';

type Props = { profile: BusinessProfile; token: string; canEdit: boolean; onSaved: (profile: BusinessProfile) => void };
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const defaultHours = (day: number): BusinessHour => ({ day_of_week: day, is_closed: 1, opening_time: null, closing_time: null });

export default function BusinessProfilePage({ profile, token, canEdit, onSaved }: Props) {
  const [form, setForm] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => setForm(profile), [profile]);
  const setField = (field: keyof BusinessProfile, value: string) => setForm(current => ({ ...current, [field]: value }));
  const setHours = (day: number, update: Partial<BusinessHour>) => setForm(current => ({ ...current, hours: days.map((_, index) => index === day ? { ...(current.hours.find(row => row.day_of_week === day) || defaultHours(day)), ...update } : current.hours.find(row => row.day_of_week === index) || defaultHours(index)) }));
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await api<BusinessProfile>('/business', 'PATCH', {
        name: form.name.trim(), ownerName: form.owner_name.trim(), phone: form.phone.trim(),
        addressLine1: form.address_line_1.trim(), addressLine2: form.address_line_2.trim(),
        city: form.city.trim(), state: form.state.trim(), zipCode: form.zip_code.trim(),
        hours: days.map((_, day) => {
          const row = form.hours.find(item => item.day_of_week === day) || defaultHours(day);
          return { dayOfWeek: day, isClosed: !!row.is_closed, openingTime: row.is_closed ? null : row.opening_time, closingTime: row.is_closed ? null : row.closing_time };
        })
      }, token);
      onSaved(result); setMessage('Business profile saved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save business profile.'); }
    finally { setSaving(false); }
  }
  return <div className="business-profile-page">
    <div className="clean-page-heading"><div><h2>Business Profile</h2><p>Business details and weekly operating hours</p></div></div>
    <form onSubmit={save}>
      <section className="clean-panel profile-section"><div className="clean-panel-header"><h3><Building2 size={17} /> Business details</h3></div><div className="profile-fields">
        <label className="form-field"><span><Building2 size={15} /> Business name</span><input required maxLength={120} disabled={!canEdit} value={form.name} onChange={event => setField('name', event.target.value)} /></label>
        <label className="form-field"><span><UserRound size={15} /> Client / owner name</span><input required maxLength={120} disabled={!canEdit} value={form.owner_name} onChange={event => setField('owner_name', event.target.value)} /></label>
        <label className="form-field"><span><Phone size={15} /> Phone number</span><input type="tel" maxLength={40} disabled={!canEdit} value={form.phone || ''} onChange={event => setField('phone', event.target.value)} /></label>
        <label className="form-field profile-wide"><span><MapPin size={15} /> Street address</span><input maxLength={250} disabled={!canEdit} value={form.address_line_1 || ''} onChange={event => setField('address_line_1', event.target.value)} /></label>
        <label className="form-field profile-wide">Address line 2<input maxLength={250} disabled={!canEdit} value={form.address_line_2 || ''} onChange={event => setField('address_line_2', event.target.value)} /></label>
        <label className="form-field">City<input maxLength={100} disabled={!canEdit} value={form.city || ''} onChange={event => setField('city', event.target.value)} /></label>
        <label className="form-field">State / region<input maxLength={100} disabled={!canEdit} value={form.state || ''} onChange={event => setField('state', event.target.value)} /></label>
        <label className="form-field">Postal code<input maxLength={30} disabled={!canEdit} value={form.zip_code || ''} onChange={event => setField('zip_code', event.target.value)} /></label>
      </div></section>
      <section className="clean-panel profile-section"><div className="clean-panel-header"><h3><Clock3 size={17} /> Operating hours</h3><span>Set each day separately</span></div><div className="profile-hours">{days.map((name, day) => {
        const row = form.hours.find(item => item.day_of_week === day) || defaultHours(day);
        return <div className="profile-day" key={name}><strong>{name}</strong><label className="profile-closed"><input type="checkbox" disabled={!canEdit} checked={!!row.is_closed} onChange={event => setHours(day, { is_closed: event.target.checked ? 1 : 0, opening_time: event.target.checked ? null : row.opening_time || '09:00', closing_time: event.target.checked ? null : row.closing_time || '17:00' })} /> Closed</label>{!row.is_closed && <div className="profile-time-fields"><label>Opens<input aria-label={`${name} opening time`} type="time" required disabled={!canEdit} value={row.opening_time || ''} onChange={event => setHours(day, { opening_time: event.target.value })} /></label><span>to</span><label>Closes<input aria-label={`${name} closing time`} type="time" required disabled={!canEdit} value={row.closing_time || ''} onChange={event => setHours(day, { closing_time: event.target.value })} /></label></div>}</div>;
      })}</div></section>
      {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="profile-success" role="status">{message}</p>}
      {canEdit && <div className="profile-actions"><button className="primary-button" disabled={saving}><Save size={16} /> {saving ? 'Saving…' : 'Save profile'}</button></div>}
    </form>
  </div>;
}
