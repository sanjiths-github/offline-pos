'use client';

import { useEffect, useState } from 'react';
import { FolderPlus, Layers3, Pencil, Plus, Search, Trash2, UtensilsCrossed, X } from 'lucide-react';
import { api, money } from '@/lib/api';
import type { Category, Product } from '@/lib/types';

type Props = { categories: Category[]; products: Product[]; token?: string; demo: boolean; canEdit: boolean; initialSearch?: string; onCategories: (categories: Category[]) => void; onProducts: (products: Product[]) => void };
type Filter = 'all' | 'active' | 'inactive';

export default function Menus({ categories, products, token, canEdit, initialSearch = '', onCategories, onProducts }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState(initialSearch);
  const [filter, setFilter] = useState<Filter>('all');
  const [modal, setModal] = useState<'product' | 'category' | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'product' | 'category'; id: number; name: string } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [taxable, setTaxable] = useState(true);

  useEffect(() => setSearch(initialSearch), [initialSearch]);
  const visible = products.filter(product =>
    (!selected || product.category_id === selected) &&
    (filter === 'all' || Boolean(product.is_active) === (filter === 'active')) &&
    (product.name.toLowerCase().includes(search.toLowerCase()) || (product.description || '').toLowerCase().includes(search.toLowerCase()))
  );
  const activeCount = products.filter(product => product.is_active).length;

  function open(kind: 'product' | 'category') {
    setEditing(null); setModal(kind); setError(''); setName(''); setDescription(''); setPrice('');
    setCategoryId(String(selected || categories[0]?.id || '')); setTaxable(true);
  }
  function edit(product: Product) {
    setEditing(product); setModal('product'); setError(''); setName(product.name);
    setDescription(product.description || ''); setPrice((product.price_cents / 100).toFixed(2));
    setCategoryId(String(product.category_id)); setTaxable(Boolean(product.is_taxable));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      if (modal === 'category') {
        const item = await api<Category>('/categories', 'POST', { name: name.trim(), description }, token);
        onCategories([...categories, item]); setSelected(item.id);
      } else {
        const cents = Math.round(Number(price) * 100);
        if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Enter a valid price.');
        const payload = { name: name.trim(), description, categoryId: Number(categoryId), priceCents: cents, isTaxable: taxable };
        const item = editing
          ? await api<Product>(`/products/${editing.id}`, 'PATCH', payload, token)
          : await api<Product>('/products', 'POST', payload, token);
        const withCategory = { ...item, category_name: categories.find(category => category.id === item.category_id)?.name };
        onProducts(editing ? products.map(product => product.id === editing.id ? withCategory : product) : [...products, withCategory]);
      }
      setModal(null); setEditing(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save menu item.'); }
    finally { setSaving(false); }
  }
  async function toggle(product: Product) {
    setError('');
    try {
      const changed = await api<Product>(`/products/${product.id}`, 'PATCH', { isActive: !product.is_active }, token);
      onProducts(products.map(item => item.id === product.id ? { ...changed, category_name: item.category_name } : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update item.'); }
  }
  async function remove() {
    if (!confirm) return;
    setSaving(true); setError('');
    try {
      await api(`/${confirm.kind === 'product' ? 'products' : 'categories'}/${confirm.id}`, 'DELETE', undefined, token);
      if (confirm.kind === 'product') onProducts(products.filter(item => item.id !== confirm.id));
      else {
        onCategories(categories.filter(item => item.id !== confirm.id));
        onProducts(products.filter(item => item.category_id !== confirm.id));
        if (selected === confirm.id) setSelected(null);
      }
      setConfirm(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete.'); }
    finally { setSaving(false); }
  }

  return <div className="premium-menus">
    <header className="menus-page-head"><div><span className="menus-eyebrow">CATALOG</span><h2>Menus</h2><p>Keep categories and prices ready for the register.</p></div>{canEdit && <div className="menus-head-actions"><button onClick={() => open('category')}><FolderPlus size={16} /> New category</button><button onClick={() => open('product')} disabled={!categories.length}><Plus size={16} /> Add menu item</button></div>}</header>
    <div className="menus-summary"><div><span>Categories</span><strong>{categories.length}</strong></div><div><span>Menu items</span><strong>{products.length}</strong></div><div><span>Available now</span><strong>{activeCount}</strong></div></div>
    <div className="menus-workspace"><aside className="menus-categories premium-panel"><div className="menus-panel-head"><span className="menus-panel-icon"><Layers3 size={16} /></span><div><h3>Categories</h3><small>Browse your menu</small></div></div><div className="menus-category-list"><button className={selected === null ? 'active' : ''} onClick={() => setSelected(null)}><span>All items</span><small>{products.length}</small></button>{categories.map(category => <div className="menus-category-entry" key={category.id}><button className={selected === category.id ? 'active' : ''} onClick={() => setSelected(category.id)}><span>{category.name}</span><small>{products.filter(product => product.category_id === category.id).length}</small></button>{canEdit && <button className="menus-category-delete" title={`Delete ${category.name}`} aria-label={`Delete ${category.name}`} onClick={() => setConfirm({ kind: 'category', id: category.id, name: category.name })}><Trash2 size={14} /></button>}</div>)}{!categories.length && <p className="menus-empty-note">Create a category to organize your menu.</p>}</div></aside>
      <section className="menus-catalog premium-panel"><div className="menus-catalog-head"><div><span className="menus-eyebrow">ITEMS</span><h3>Menu collection</h3></div><span>{visible.length} shown</span></div><div className="menus-toolbar"><div className="menus-search"><Search size={17} /><input aria-label="Search menu items" placeholder="Search name or description" value={search} onChange={event => setSearch(event.target.value)} /></div><div className="menus-filters" aria-label="Filter menu availability"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button><button className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>Available</button><button className={filter === 'inactive' ? 'active' : ''} onClick={() => setFilter('inactive')}>Unavailable</button></div></div>
        {visible.length ? <div className="menu-card-grid">{visible.map(product => <article className="menu-card" key={product.id}><span className="menu-card-curve" aria-hidden="true" /><div className="menu-card-top"><span className="menu-card-icon"><UtensilsCrossed size={20} strokeWidth={1.6} /></span><span className={product.is_active ? 'menu-card-status active' : 'menu-card-status'}>{product.is_active ? 'Available' : 'Unavailable'}</span></div><div className="menu-card-copy"><small>{product.category_name || categories.find(category => category.id === product.category_id)?.name || 'Menu item'}</small><h4>{product.name}</h4><p>{product.description || 'No description'}</p></div><div className="menu-card-bottom"><strong>{money(product.price_cents)}</strong>{canEdit && <div className="menu-card-actions"><button title={`Edit ${product.name}`} aria-label={`Edit ${product.name}`} onClick={() => edit(product)}><Pencil size={15} /></button><button onClick={() => toggle(product)}>{product.is_active ? 'Deactivate' : 'Activate'}</button><button className="clean-icon-danger" title={`Delete ${product.name}`} aria-label={`Delete ${product.name}`} onClick={() => setConfirm({ kind: 'product', id: product.id, name: product.name })}><Trash2 size={15} /></button></div>}</div></article>)}</div> : <div className="menus-empty"><UtensilsCrossed size={22} /><strong>No menu items found</strong><span>Try another category or search.</span></div>}
      </section></div>
    {error && !modal && !confirm && <p className="form-error" role="alert">{error}</p>}
    {modal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null); }}><form className="modal menus-modal" onSubmit={save}><div className="modal-header"><div><h2>{modal === 'category' ? 'New category' : editing ? 'Edit menu item' : 'New menu item'}</h2><p>{modal === 'category' ? 'Group related items together.' : 'Set the details staff see at the register.'}</p></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setModal(null)}><X size={19} /></button></div><div className="modal-body"><label className="form-field">Name<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><label className="form-field">Description<input maxLength={300} value={description} onChange={event => setDescription(event.target.value)} /></label>{modal === 'product' && <><label className="form-field">Category<select required value={categoryId} onChange={event => setCategoryId(event.target.value)}>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="form-field">Price<input required type="number" min="0" step="0.01" value={price} onChange={event => setPrice(event.target.value)} /></label><label className="check-field"><input type="checkbox" checked={taxable} onChange={event => setTaxable(event.target.checked)} /> Taxable</label></>}{error && <p className="form-error" role="alert">{error}</p>}</div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Create'}</button></div></form></div>}
    {confirm && <div className="modal-backdrop"><div className="modal menus-modal" role="dialog" aria-modal="true" aria-label={`Delete ${confirm.kind}`}><div className="modal-header"><div><h2>Delete {confirm.kind}?</h2><p>{confirm.name}</p></div></div><div className="modal-body"><p>{confirm.kind === 'category' ? 'Items in this category will also leave the active menu. Past sales stay in history.' : 'This item will leave the menu. Past sales stay in history.'}</p>{error && <p className="form-error" role="alert">{error}</p>}</div><div className="modal-actions"><button className="secondary-button" onClick={() => setConfirm(null)}>No, keep it</button><button className="clean-danger-button" disabled={saving} onClick={remove}>{saving ? 'Deleting...' : 'Yes, delete'}</button></div></div></div>}
  </div>;
}
