'use client';
import { useEffect, useState } from 'react';
import { Coffee, Folder, Plus, Search, Trash2, X } from 'lucide-react';
import { api, money } from '@/lib/api';
import type { Category, Product } from '@/lib/types';

type Props = { categories: Category[]; products: Product[]; token?: string; demo: boolean; canEdit: boolean; initialSearch?: string; onCategories: (categories: Category[]) => void; onProducts: (products: Product[]) => void };
export default function Menus({ categories, products, token, canEdit, initialSearch = '', onCategories, onProducts }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState(initialSearch);
  const [modal, setModal] = useState<'product' | 'category' | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'product' | 'category'; id: number; name: string } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [taxable, setTaxable] = useState(true);
  useEffect(() => setSearch(initialSearch), [initialSearch]);
  const visible = products.filter(product => (!selected || product.category_id === selected) && product.name.toLowerCase().includes(search.toLowerCase()));
  function open(kind: 'product' | 'category') { setModal(kind); setError(''); setName(''); setDescription(''); setPrice(''); setCategoryId(String(categories[0]?.id || '')); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      if (modal === 'category') {
        const item = await api<Category>('/categories','POST',{ name: name.trim(), description },token);
        onCategories([...categories,item]);
      } else {
        const cents = Math.round(Number(price)*100);
        if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Enter a valid price.');
        const item = await api<Product>('/products','POST',{ name: name.trim(), description, categoryId: Number(categoryId), priceCents: cents, isTaxable: taxable },token);
        onProducts([...products,item]);
      }
      setModal(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save'); }
    finally { setSaving(false); }
  }
  async function toggle(product: Product) {
    setError('');
    try { const changed = await api<Product>(`/products/${product.id}`,'PATCH',{ isActive: !product.is_active },token); onProducts(products.map(item => item.id === product.id ? changed : item)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update item'); }
  }
  async function remove() {
    if (!confirm) return;
    setSaving(true); setError('');
    try {
      await api(`/${confirm.kind === 'product' ? 'products' : 'categories'}/${confirm.id}`,'DELETE',undefined,token);
      if (confirm.kind === 'product') onProducts(products.filter(item => item.id !== confirm.id));
      else { onCategories(categories.filter(item => item.id !== confirm.id)); onProducts(products.filter(item => item.category_id !== confirm.id)); if (selected === confirm.id) setSelected(null); }
      setConfirm(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete'); }
    finally { setSaving(false); }
  }
  return <div className="clean-menu-page">
    <div className="clean-page-heading"><div><h2>Menus</h2><p>Categories and items available for billing.</p></div>{canEdit && <div className="head-actions"><button className="secondary-button" onClick={() => open('category')}><Folder size={17} /> Add category</button><button className="primary-button" disabled={!categories.length} onClick={() => open('product')}><Plus size={17} /> Add item</button></div>}</div>
    <div className="clean-menu-layout"><aside className="clean-panel clean-categories"><div className="clean-panel-header"><h3>Categories</h3><span>{categories.length}</span></div><button className={!selected ? 'selected' : ''} onClick={() => setSelected(null)}>All items <span>{products.length}</span></button>{categories.map(category => <div className="clean-category-row" key={category.id}><button className={selected === category.id ? 'selected' : ''} onClick={() => setSelected(category.id)}>{category.name}<span>{products.filter(product => product.category_id === category.id).length}</span></button>{canEdit && <button className="clean-icon-danger" title={`Delete ${category.name}`} onClick={() => setConfirm({ kind: 'category', id: category.id, name: category.name })}><Trash2 size={15} /></button>}</div>)}{!categories.length && <p className="clean-panel-note">Add a category to start your menu.</p>}</aside>
      <section className="clean-panel clean-menu-items"><div className="clean-panel-header"><h3>Menu items</h3><div className="search-field"><Search size={17} /><input placeholder="Search items" value={search} onChange={event => setSearch(event.target.value)} /></div></div>{visible.length ? <div className="clean-table-wrap"><table className="clean-table"><thead><tr><th>Item</th><th>Category</th><th>Price</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead><tbody>{visible.map(product => <tr key={product.id}><td><span className="clean-product-name"><Coffee size={18} /> {product.name}</span><small>{product.description}</small></td><td>{categories.find(category => category.id === product.category_id)?.name || '—'}</td><td>{money(product.price_cents)}</td><td><span className={product.is_active ? 'clean-connected' : 'clean-disconnected'}>{product.is_active ? 'Active' : 'Inactive'}</span></td>{canEdit && <td><div className="clean-row-actions"><button className="clean-link" onClick={() => toggle(product)}>{product.is_active ? 'Deactivate' : 'Activate'}</button><button className="clean-icon-danger" title={`Delete ${product.name}`} onClick={() => setConfirm({ kind: 'product', id: product.id, name: product.name })}><Trash2 size={16} /></button></div></td>}</tr>)}</tbody></table></div> : <div className="clean-empty">No menu items found.</div>}</section></div>
    {error && !modal && !confirm && <p className="form-error">{error}</p>}
    {modal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null); }}><form className="modal" onSubmit={save}><div className="modal-header"><div><h2>Add {modal === 'category' ? 'category' : 'menu item'}</h2></div><button type="button" className="icon-button" onClick={() => setModal(null)}><X size={19} /></button></div><div className="modal-body"><label className="form-field">Name<input required value={name} onChange={event => setName(event.target.value)} /></label><label className="form-field">Description<input value={description} onChange={event => setDescription(event.target.value)} /></label>{modal === 'product' && <><label className="form-field">Category<select required value={categoryId} onChange={event => setCategoryId(event.target.value)}>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="form-field">Price<input required type="number" min="0" step="0.01" value={price} onChange={event => setPrice(event.target.value)} /></label><label className="check-field"><input type="checkbox" checked={taxable} onChange={event => setTaxable(event.target.checked)} /> Taxable</label></>}{error && <p className="form-error">{error}</p>}</div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div></form></div>}
    {confirm && <div className="modal-backdrop"><div className="modal"><div className="modal-header"><div><h2>Delete {confirm.kind}?</h2><p>{confirm.name}</p></div></div><div className="modal-body"><p>{confirm.kind === 'category' ? 'All menu items in this category will also be removed from the active menu. Past sales remain unchanged.' : 'This item will no longer appear on the menu. Past sales remain unchanged.'}</p>{error && <p className="form-error">{error}</p>}</div><div className="modal-actions"><button className="secondary-button" onClick={() => setConfirm(null)}>Cancel</button><button className="clean-danger-button" disabled={saving} onClick={remove}>{saving ? 'Deleting…' : 'Delete'}</button></div></div></div>}
  </div>;
}
