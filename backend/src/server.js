const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { db, bcrypt, hashToken, temporaryPassword, hashPassword, audit, issueSession, authenticate, access } = require('./security');
const { integer, persistCalculation } = require('./billing');
const { dbPath, dataDir } = require('./db');
const { renderReceipt, printSale, listSystemPrinters, testPrinter } = require('./printerService');
const { createBackup, automaticBackup, restoreBackup, listBackups } = require('./backupService');
const { deviceDate, sqliteUtcDate, deviceDateTime } = require('./deviceTime');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname,'..','public')));
const route = (method,url,...handlers) => app[method]('/api'+url,...handlers.map(h => (req,res,next) => { try { const out=h(req,res,next); if (out?.catch) out.catch(next); } catch(e) { next(e); } }));
const fail = (message,status=400) => { throw Object.assign(new Error(message),{status}); };
const required = (v,name) => { if (typeof v !== 'string' || !v.trim()) fail(`${name} is required`); return v.trim(); };
const enumValue = (v,choices,name) => { if (!choices.includes(v)) fail(`Invalid ${name}`); return v; };
const bool = v => v ? 1 : 0;
const yes = v => !!v;
const id = req => integer(Number(req.params.id),'id',1);
const send = (res, value, code=200) => res.status(code).json(value);
const admin = access('BUSINESS_ADMIN');
const working = access('BUSINESS_ADMIN','CASHIER');
const system = access('SYSTEM_ADMIN');
const getSale = saleId => {
  const sale=db.prepare('SELECT s.*,u.username AS cashier FROM sales s JOIN users u ON u.id=s.cashier_user_id WHERE s.id=?').get(saleId);
  if (!sale) fail('Sale not found',404);
  return { ...sale, items: db.prepare('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id').all(saleId), payment: db.prepare('SELECT * FROM payments WHERE sale_id=?').get(saleId)||null, printJobs: db.prepare('SELECT * FROM print_jobs WHERE sale_id=? ORDER BY id DESC').all(saleId) };
};
const saleAllowed = (req,sale) => { if (req.user.role==='CASHIER' && sale.cashier_user_id!==req.user.id) fail('Forbidden',403); };
function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const out=fn(); db.exec('COMMIT'); return out; } catch(e) { db.exec('ROLLBACK'); throw e; } }
function createUser(input,role,actor) {
  const username=required(input.username,'username');
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) fail('Invalid username');
  if (input.employeeId != null && !db.prepare('SELECT id FROM employees WHERE id=?').get(input.employeeId)) fail('Employee not found');
  const password=temporaryPassword();
  const result=db.prepare("INSERT INTO users(employee_id,username,password_hash,role,temporary_password_expires_at) VALUES(?,?,?,?,datetime('now','+24 hours'))").run(input.employeeId||null,username,hashPassword(password),role);
  audit(actor,'USER_CREATED','users',Number(result.lastInsertRowid),{username,role});
  return { id:Number(result.lastInsertRowid),username,role,temporaryPassword:password,mustChangePassword:true };
}
function resetUser(target,actor) {
  const password=temporaryPassword();
  db.prepare("UPDATE users SET password_hash=?,must_change_password=1,temporary_password_expires_at=datetime('now','+24 hours'),session_version=session_version+1,failed_login_attempts=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(hashPassword(password),target.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
  audit(actor,'PASSWORD_RESET','users',target.id,{username:target.username,role:target.role});
  return { temporaryPassword:password,mustChangePassword:true };
}

route('get','/health',(req,res)=>send(res,{ok:true,offline:true}));
route('post','/auth/login',(req,res)=>{
  const username=required(req.body.username,'username');
  const user=db.prepare('SELECT * FROM users WHERE username=?').get(username);
  const invalid=()=>send(res,{error:'Invalid credentials'},401);
  if (!user || !user.is_active) return invalid();
  if (user.locked_until && user.locked_until > new Date().toISOString().replace('T',' ').slice(0,19)) return send(res,{error:'Account temporarily locked'},423);
  if (!bcrypt.compareSync(String(req.body.password||''),user.password_hash)) {
    db.prepare("UPDATE users SET failed_login_attempts=failed_login_attempts+1,locked_until=CASE WHEN failed_login_attempts>=4 THEN datetime('now','+15 minutes') ELSE locked_until END WHERE id=?").run(user.id);
    audit(user.id,'LOGIN_FAILED','users',user.id);
    return invalid();
  }
  if (user.must_change_password && user.temporary_password_expires_at && user.temporary_password_expires_at < new Date().toISOString().replace('T',' ').slice(0,19)) return send(res,{error:'Temporary password expired. Ask an administrator to reset it.'},403);
  const business=db.prepare('SELECT status FROM businesses WHERE id=1').get();
  if (user.role!=='SYSTEM_ADMIN' && business?.status!=='ACTIVE') return send(res,{error:'Business inactive'},403);
  db.prepare('UPDATE users SET failed_login_attempts=0,locked_until=NULL,last_login_at=CURRENT_TIMESTAMP WHERE id=?').run(user.id);
  audit(user.id,'LOGIN','users',user.id);
  send(res,{token:issueSession(user),user:{id:user.id,username:user.username,role:user.role,mustChangePassword:!!user.must_change_password}});
});
route('post','/auth/logout',authenticate,(req,res)=>{db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.tokenHash);send(res,{ok:true});});
route('get','/auth/me',authenticate,(req,res)=>send(res,{user:{id:req.user.id,username:req.user.username,role:req.user.role,mustChangePassword:!!req.user.must_change_password}}));
route('post','/auth/change-password',authenticate,(req,res)=>{
  const current=required(req.body.currentPassword,'currentPassword');
  const next=required(req.body.newPassword,'newPassword');
  if (next.length<10 || next.length>128) fail('New password must be 10-128 characters');
  if (next!==req.body.confirmPassword) fail('Passwords do not match');
  const user=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(current,user.password_hash)) fail('Current password is incorrect',403);
  if (bcrypt.compareSync(next,user.password_hash)) fail('Choose a different password');
  db.prepare('UPDATE users SET password_hash=?,must_change_password=0,temporary_password_expires_at=NULL,password_changed_at=CURRENT_TIMESTAMP,session_version=session_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(hashPassword(next),user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
  audit(user.id,'PASSWORD_CHANGED','users',user.id);
  const updated=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  send(res,{token:issueSession(updated),user:{id:user.id,username:user.username,role:user.role,mustChangePassword:false}});
});

route('get','/system/status',authenticate,system,(req,res)=>send(res,{business:db.prepare('SELECT * FROM businesses WHERE id=1').get()||null,users:db.prepare("SELECT id,username,role,is_active FROM users WHERE role='BUSINESS_ADMIN'").all()}));
route('post','/system/business',authenticate,system,(req,res)=>{
  if (db.prepare('SELECT id FROM businesses WHERE id=1').get()) fail('Business already exists',409);
  const b=req.body;
  const output=transaction(()=>{
    db.prepare('INSERT INTO businesses(id,name,owner_name,address_line_1,address_line_2,city,state,zip_code,phone,email,tax_id,currency,timezone,default_tax_rate_bps,receipt_footer) VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(required(b.name,'name'),required(b.ownerName,'ownerName'),b.addressLine1||'',b.addressLine2||'',b.city||'',b.state||'',b.zipCode||'',b.phone||'',b.email||'',b.taxId||'','USD',b.timezone||'America/New_York',integer(b.defaultTaxRateBps??0,'defaultTaxRateBps',0,10000),b.receiptFooter||'Thank you for your business!');
    const user=createUser({username:b.adminUsername},'BUSINESS_ADMIN',req.user.id);
    audit(req.user.id,'BUSINESS_CREATED','businesses',1,{name:b.name});
    return {business:db.prepare('SELECT * FROM businesses WHERE id=1').get(),admin:user};
  }); send(res,output,201);
});
route('post','/system/users/:id/reset-password',authenticate,system,(req,res)=>{const u=db.prepare('SELECT * FROM users WHERE id=?').get(id(req));if (!u||u.role!=='BUSINESS_ADMIN') fail('Business admin not found',404);send(res,resetUser(u,req.user.id));});
route('patch','/system/business/status',authenticate,system,(req,res)=>{const status=enumValue(req.body.status,['ACTIVE','INACTIVE'],'status');db.prepare('UPDATE businesses SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(status);audit(req.user.id,'BUSINESS_STATUS','businesses',1,{status});send(res,{status});});

const businessProfile = () => {
  const business = db.prepare('SELECT * FROM businesses WHERE id=1').get();
  return business ? { ...business, hours: db.prepare('SELECT day_of_week,is_closed,opening_time,closing_time FROM business_hours WHERE business_id=1 ORDER BY day_of_week').all() } : null;
};
route('get','/business',authenticate,working,(req,res)=>send(res,businessProfile()));
route('patch','/business',authenticate,admin,(req,res)=>{
  const b=req.body, old=db.prepare('SELECT * FROM businesses WHERE id=1').get();
  if (!old) fail('Business missing',404);
  const fields=['name','owner_name','address_line_1','address_line_2','city','state','zip_code','phone','email','tax_id','timezone','default_tax_rate_bps','receipt_footer'];
  const map={ownerName:'owner_name',addressLine1:'address_line_1',addressLine2:'address_line_2',zipCode:'zip_code',taxId:'tax_id',defaultTaxRateBps:'default_tax_rate_bps',receiptFooter:'receipt_footer'};
  const edits=Object.entries(b).map(([k,v])=>[map[k]||k,v]).filter(([k])=>fields.includes(k));
  if (edits.some(([k])=>k==='default_tax_rate_bps')) integer(edits.find(([k])=>k==='default_tax_rate_bps')[1],'defaultTaxRateBps',0,10000);
  for (const [key,value] of edits) {
    if (key==='name'||key==='owner_name') required(value,key);
    else if (key!=='default_tax_rate_bps' && (typeof value!=='string'||value.length>500)) fail(`Invalid ${key}`);
  }
  let hours;
  if (b.hours!==undefined) {
    if (!Array.isArray(b.hours)||b.hours.length!==7) fail('Hours must include all seven days');
    const days = new Set();
    hours = b.hours.map(row=>{
      const day=integer(row.dayOfWeek,'dayOfWeek',0,6);
      if (days.has(day)) fail('Duplicate business day');
      days.add(day);
      if (typeof row.isClosed!=='boolean') fail('Invalid closed status');
      const opening=row.isClosed?null:row.openingTime;
      const closing=row.isClosed?null:row.closingTime;
      if (!row.isClosed && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(opening)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(closing)||opening===closing)) fail('Enter valid opening and closing times');
      return {day,closed:row.isClosed?1:0,opening,closing};
    });
  }
  transaction(()=>{
    if (edits.length) db.prepare(`UPDATE businesses SET ${edits.map(([k])=>`${k}=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=1`).run(...edits.map(([,v])=>v));
    if (hours) {
      const statement=db.prepare('INSERT INTO business_hours(business_id,day_of_week,is_closed,opening_time,closing_time) VALUES(1,?,?,?,?) ON CONFLICT(business_id,day_of_week) DO UPDATE SET is_closed=excluded.is_closed,opening_time=excluded.opening_time,closing_time=excluded.closing_time');
      for (const row of hours) statement.run(row.day,row.closed,row.opening,row.closing);
    }
    audit(req.user.id,'BUSINESS_UPDATED','businesses',1,{fields:[...edits.map(([k])=>k),...(hours?['hours']:[])]});
  });
  send(res,businessProfile());
});
route('get','/dashboard/insights',authenticate,working,(req,res)=>{
  const now=new Date(), monday=new Date(now.getFullYear(),now.getMonth(),now.getDate()-((now.getDay()+6)%7));
  const dates=Array.from({length:7},(_,day)=>deviceDate(new Date(monday.getFullYear(),monday.getMonth(),monday.getDate()+day)));
  const scope=req.user.role==='CASHIER'?'AND s.cashier_user_id=?':'';
  const scoped=req.user.role==='CASHIER'?[req.user.id]:[];
  const rows=db.prepare(`SELECT date(s.completed_at,'localtime') AS day,COUNT(*) AS orders,COALESCE(SUM(s.total_cents),0) AS revenue_cents FROM sales s WHERE s.status='COMPLETED' AND date(s.completed_at,'localtime') BETWEEN ? AND ? ${scope} GROUP BY day`).all(dates[0],dates[6],...scoped);
  const byDate=new Map(rows.map(row=>[row.day,row]));
  const weeklySales=dates.map(date=>({date,orders:byDate.get(date)?.orders||0,revenue_cents:byDate.get(date)?.revenue_cents||0}));
  const topItems=db.prepare(`SELECT si.product_name_snapshot AS name,si.category_name_snapshot AS category,SUM(si.quantity) AS quantity,SUM(si.line_total_cents) AS revenue_cents FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.status='COMPLETED' ${scope} GROUP BY si.product_name_snapshot,si.category_name_snapshot ORDER BY quantity DESC,revenue_cents DESC,name LIMIT 5`).all(...scoped);
  send(res,{weeklySales,topItems});
});
route('get','/users',authenticate,admin,(req,res)=>send(res,db.prepare("SELECT id,employee_id,username,role,must_change_password,is_active,created_at,last_login_at FROM users WHERE role!='SYSTEM_ADMIN' ORDER BY id").all()));
route('post','/users',authenticate,admin,(req,res)=>send(res,createUser(req.body,'CASHIER',req.user.id),201));
route('patch','/users/:id',authenticate,admin,(req,res)=>{const u=db.prepare('SELECT * FROM users WHERE id=?').get(id(req));if (!u||u.role!=='CASHIER') fail('Cashier not found',404);const active=bool(req.body.isActive);db.prepare('UPDATE users SET is_active=?,session_version=session_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(active,u.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);audit(req.user.id,'USER_STATUS','users',u.id,{isActive:!!active});send(res,{id:u.id,isActive:!!active});});
route('post','/users/:id/reset-password',authenticate,admin,(req,res)=>{const u=db.prepare('SELECT * FROM users WHERE id=?').get(id(req));if (!u||u.role!=='CASHIER') fail('Cashier not found',404);send(res,resetUser(u,req.user.id));});

const employeeFields=['employee_code','first_name','last_name','phone','email','address_line_1','address_line_2','city','state','zip_code','job_role','salary_cents','salary_type','hire_date','employment_status','notes'];
const employeeMap={employeeCode:'employee_code',firstName:'first_name',lastName:'last_name',addressLine1:'address_line_1',addressLine2:'address_line_2',zipCode:'zip_code',jobRole:'job_role',salaryCents:'salary_cents',salaryType:'salary_type',hireDate:'hire_date',employmentStatus:'employment_status'};
const employeeData=b=>Object.fromEntries(Object.entries(b).map(([k,v])=>[employeeMap[k]||k,v]).filter(([k])=>employeeFields.includes(k)));
route('get','/employees',authenticate,admin,(req,res)=>send(res,db.prepare('SELECT * FROM employees ORDER BY id DESC').all()));
route('get','/employees/:id',authenticate,admin,(req,res)=>{const e=db.prepare('SELECT * FROM employees WHERE id=?').get(id(req));if(!e)fail('Employee not found',404);send(res,e);});
route('post','/employees',authenticate,admin,(req,res)=>{const e=employeeData(req.body);required(e.first_name,'firstName');required(e.last_name,'lastName');required(e.phone,'phone');required(e.job_role,'jobRole');e.salary_cents=integer(e.salary_cents??0,'salaryCents');e.salary_type=enumValue(e.salary_type||'HOURLY',['HOURLY','WEEKLY','MONTHLY','ANNUAL'],'salaryType');const keys=Object.keys(e);const result=db.prepare(`INSERT INTO employees(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(e));audit(req.user.id,'EMPLOYEE_CREATED','employees',Number(result.lastInsertRowid));send(res,db.prepare('SELECT * FROM employees WHERE id=?').get(result.lastInsertRowid),201);});
route('patch','/employees/:id',authenticate,admin,(req,res)=>{const e=employeeData(req.body);if (e.salary_cents!==undefined)integer(e.salary_cents,'salaryCents');if(e.salary_type)enumValue(e.salary_type,['HOURLY','WEEKLY','MONTHLY','ANNUAL'],'salaryType');if(e.employment_status)enumValue(e.employment_status,['ACTIVE','INACTIVE','TERMINATED'],'employmentStatus');const keys=Object.keys(e);if(keys.length)db.prepare(`UPDATE employees SET ${keys.map(k=>`${k}=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...Object.values(e),id(req));audit(req.user.id,'EMPLOYEE_UPDATED','employees',id(req),{fields:keys});send(res,db.prepare('SELECT * FROM employees WHERE id=?').get(id(req)));});
route('delete','/employees/:id',authenticate,admin,(req,res)=>{db.prepare("UPDATE employees SET employment_status='INACTIVE',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id(req));audit(req.user.id,'EMPLOYEE_DEACTIVATED','employees',id(req));send(res,{ok:true});});

route('get','/categories',authenticate,working,(req,res)=>send(res,db.prepare(`SELECT * FROM categories ${req.query.includeInactive==='true'?'':'WHERE is_active=1'} ORDER BY display_order,name`).all()));
route('get','/categories/:id',authenticate,working,(req,res)=>{const x=db.prepare('SELECT * FROM categories WHERE id=?').get(id(req));if(!x)fail('Category not found',404);send(res,x);});
route('post','/categories',authenticate,admin,(req,res)=>{const b=req.body;const r=db.prepare('INSERT INTO categories(name,description,display_order) VALUES(?,?,?)').run(required(b.name,'name'),b.description||'',integer(b.displayOrder??0,'displayOrder'));audit(req.user.id,'CATEGORY_CREATED','categories',Number(r.lastInsertRowid));send(res,db.prepare('SELECT * FROM categories WHERE id=?').get(r.lastInsertRowid),201);});
route('patch','/categories/:id',authenticate,admin,(req,res)=>{const b=req.body;const e={};if(b.name!==undefined)e.name=required(b.name,'name');if(b.description!==undefined)e.description=b.description;if(b.displayOrder!==undefined)e.display_order=integer(b.displayOrder,'displayOrder');if(b.isActive!==undefined)e.is_active=bool(b.isActive);const keys=Object.keys(e);if(keys.length)db.prepare(`UPDATE categories SET ${keys.map(k=>`${k}=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...Object.values(e),id(req));audit(req.user.id,'CATEGORY_UPDATED','categories',id(req),{fields:keys});send(res,db.prepare('SELECT * FROM categories WHERE id=?').get(id(req)));});
route('delete','/categories/:id',authenticate,admin,(req,res)=>{const category=db.prepare('SELECT * FROM categories WHERE id=? AND is_active=1').get(id(req));if(!category)fail('Category not found',404);const count=transaction(()=>{db.prepare('UPDATE categories SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(category.id);const result=db.prepare('UPDATE products SET is_active=0,deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE category_id=? AND deleted_at IS NULL').run(category.id);audit(req.user.id,'CATEGORY_DELETED','categories',category.id,{name:category.name,products:Number(result.changes)});return Number(result.changes);});send(res,{ok:true,productsRemoved:count});});
route('get','/products',authenticate,working,(req,res)=>{const where=['p.deleted_at IS NULL','c.is_active=1'],params=[];if(req.query.categoryId){where.push('p.category_id=?');params.push(integer(Number(req.query.categoryId),'categoryId',1));}if(req.query.search){where.push('p.name LIKE ?');params.push('%'+req.query.search+'%');}if(req.query.active==='true')where.push('p.is_active=1');if(req.query.active==='false')where.push('p.is_active=0');send(res,db.prepare(`SELECT p.*,c.name AS category_name FROM products p JOIN categories c ON c.id=p.category_id WHERE ${where.join(' AND ')} ORDER BY p.name`).all(...params));});
route('get','/products/:id',authenticate,working,(req,res)=>{const x=db.prepare('SELECT * FROM products WHERE id=?').get(id(req));if(!x)fail('Product not found',404);send(res,x);});
route('post','/products',authenticate,admin,(req,res)=>{const b=req.body;const categoryId=integer(b.categoryId,'categoryId',1);if(!db.prepare('SELECT id FROM categories WHERE id=? AND is_active=1').get(categoryId))fail('Active category not found');const r=db.prepare('INSERT INTO products(category_id,name,description,price_cents,is_taxable,tax_rate_override_bps) VALUES(?,?,?,?,?,?)').run(categoryId,required(b.name,'name'),b.description||'',integer(b.priceCents,'priceCents'),b.isTaxable===false?0:1,b.taxRateOverrideBps==null?null:integer(b.taxRateOverrideBps,'taxRateOverrideBps',0,10000));audit(req.user.id,'PRODUCT_CREATED','products',Number(r.lastInsertRowid));send(res,db.prepare('SELECT * FROM products WHERE id=?').get(r.lastInsertRowid),201);});
route('patch','/products/:id',authenticate,admin,(req,res)=>{const b=req.body,e={};if(b.categoryId!==undefined)e.category_id=integer(b.categoryId,'categoryId',1);if(b.name!==undefined)e.name=required(b.name,'name');if(b.description!==undefined)e.description=b.description;if(b.priceCents!==undefined)e.price_cents=integer(b.priceCents,'priceCents');if(b.isTaxable!==undefined)e.is_taxable=bool(b.isTaxable);if(b.taxRateOverrideBps!==undefined)e.tax_rate_override_bps=b.taxRateOverrideBps===null?null:integer(b.taxRateOverrideBps,'taxRateOverrideBps',0,10000);if(b.isActive!==undefined)e.is_active=bool(b.isActive);const old=db.prepare('SELECT * FROM products WHERE id=?').get(id(req));if(!old)fail('Product not found',404);const keys=Object.keys(e);if(keys.length)db.prepare(`UPDATE products SET ${keys.map(k=>`${k}=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...Object.values(e),id(req));audit(req.user.id,'PRODUCT_UPDATED','products',id(req),{fields:keys,oldPriceCents:old.price_cents,newPriceCents:e.price_cents});send(res,db.prepare('SELECT * FROM products WHERE id=?').get(id(req)));});
route('delete','/products/:id',authenticate,admin,(req,res)=>{const product=db.prepare('SELECT id,name FROM products WHERE id=? AND deleted_at IS NULL').get(id(req));if(!product)fail('Product not found',404);db.prepare('UPDATE products SET is_active=0,deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(product.id);audit(req.user.id,'PRODUCT_DELETED','products',product.id,{name:product.name});send(res,{ok:true});});
route('get','/customers',authenticate,working,(req,res)=>send(res,db.prepare('SELECT * FROM customers WHERE phone LIKE ? ORDER BY name LIMIT 50').all('%'+(req.query.phone||'')+'%')));
route('post','/customers',authenticate,working,(req,res)=>{const name=required(req.body.name,'name'),phone=required(req.body.phone,'phone');if(name.length>120||phone.length>40)fail('Customer details are too long');db.prepare('INSERT INTO customers(name,phone) VALUES(?,?) ON CONFLICT(phone) DO UPDATE SET name=excluded.name,updated_at=CURRENT_TIMESTAMP').run(name,phone);const customer=db.prepare('SELECT * FROM customers WHERE phone=?').get(phone);audit(req.user.id,'CUSTOMER_SAVED','customers',customer.id);send(res,customer);});
route('patch','/customers/:id',authenticate,working,(req,res)=>{const customer=db.prepare('SELECT * FROM customers WHERE id=?').get(id(req));if(!customer)fail('Customer not found',404);const name=required(req.body.name,'name'),phone=required(req.body.phone,'phone');if(name.length>120||phone.length>40)fail('Customer details are too long');db.prepare('UPDATE customers SET name=?,phone=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name,phone,customer.id);audit(req.user.id,'CUSTOMER_UPDATED','customers',customer.id);send(res,db.prepare('SELECT * FROM customers WHERE id=?').get(customer.id));});

route('get','/shifts',authenticate,working,(req,res)=>send(res,db.prepare(`SELECT s.*,u.username FROM shifts s JOIN users u ON u.id=s.user_id ${req.user.role==='CASHIER'?'WHERE s.user_id=?':''} ORDER BY s.id DESC LIMIT 100`).all(...(req.user.role==='CASHIER'?[req.user.id]:[]))));
route('post','/shifts/open',authenticate,working,(req,res)=>{if(db.prepare("SELECT id FROM shifts WHERE user_id=? AND status='OPEN'").get(req.user.id))fail('Shift already open',409);const r=db.prepare('INSERT INTO shifts(user_id,opening_cash_cents) VALUES(?,?)').run(req.user.id,integer(req.body.openingCashCents??0,'openingCashCents'));audit(req.user.id,'SHIFT_OPENED','shifts',Number(r.lastInsertRowid));send(res,db.prepare('SELECT * FROM shifts WHERE id=?').get(r.lastInsertRowid),201);});
route('post','/shifts/:id/close',authenticate,working,(req,res)=>{const shift=db.prepare('SELECT * FROM shifts WHERE id=?').get(id(req));if(!shift||shift.status!=='OPEN')fail('Open shift not found',404);if(req.user.role==='CASHIER'&&shift.user_id!==req.user.id)fail('Forbidden',403);const cash=db.prepare("SELECT COALESCE(SUM(p.amount_cents),0) AS amount FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.shift_id=? AND p.method='CASH'").get(shift.id).amount;const actual=integer(req.body.actualCashCents,'actualCashCents');const expected=shift.opening_cash_cents+cash;db.prepare("UPDATE shifts SET status='CLOSED',closed_at=CURRENT_TIMESTAMP,cash_sales_cents=?,expected_cash_cents=?,actual_cash_cents=?,difference_cents=? WHERE id=?").run(cash,expected,actual,actual-expected,shift.id);audit(req.user.id,'SHIFT_CLOSED','shifts',shift.id,{differenceCents:actual-expected});send(res,db.prepare('SELECT * FROM shifts WHERE id=?').get(shift.id));});
route('get','/sales',authenticate,working,(req,res)=>{
  const where=["s.status!='DRAFT'"],params=[];
  if(req.user.role==='CASHIER'){where.push('s.cashier_user_id=?');params.push(req.user.id);}
  const filters={orderType:'order_type',orderSource:'order_source',cashierId:'cashier_user_id',receipt:'receipt_number'};
  for(const [query,col] of Object.entries(filters))if(req.query[query]){where.push(`s.${col}=?`);params.push(req.query[query]);}
  if(req.query.paymentMethod){where.push('p.method=?');params.push(req.query.paymentMethod);}
  const from=req.query.from,to=req.query.to,period=req.query.period||'ALL';
  if((from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))||(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to))||(from&&to&&from>to))fail('Invalid date range');
  enumValue(period,['ALL','MORNING','NOON','EVENING','NIGHT'],'period');
  const formatter=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
  const rows=db.prepare(`SELECT s.*,u.username AS cashier,p.method AS payment_method FROM sales s JOIN users u ON u.id=s.cashier_user_id LEFT JOIN payments p ON p.sale_id=s.id WHERE ${where.join(' AND ')} ORDER BY s.id DESC`).all(...params);
  const result=rows.filter(sale=>{
    const stamp=sqliteUtcDate(sale.completed_at||sale.created_at);
    if(!stamp)return false;
    const parts=Object.fromEntries(formatter.formatToParts(stamp).map(part=>[part.type,part.value]));
    const date=`${parts.year}-${parts.month}-${parts.day}`,hour=Number(parts.hour);
    if(from&&date<from||to&&date>to)return false;
    if(period==='MORNING')return hour>=5&&hour<12;
    if(period==='NOON')return hour>=12&&hour<17;
    if(period==='EVENING')return hour>=17&&hour<21;
    if(period==='NIGHT')return hour>=21||hour<5;
    return true;
  });
  send(res,result.slice(0,500));
});
route('get','/sales/drafts',authenticate,working,(req,res)=>send(res,db.prepare("SELECT * FROM sales WHERE status='DRAFT' AND cashier_user_id=? ORDER BY updated_at DESC").all(req.user.id)));
route('post','/sales',authenticate,working,(req,res)=>{const b=req.body;const orderType=enumValue(b.orderType,['DINE_IN','TAKEAWAY'],'orderType'),orderSource=enumValue(b.orderSource,['POS','PHONE'],'orderSource');if(orderSource==='PHONE'){required(b.customerName,'customerName');required(b.customerPhone,'customerPhone');}const shift=db.prepare("SELECT id FROM shifts WHERE user_id=? AND status='OPEN'").get(req.user.id);const r=db.prepare('INSERT INTO sales(cashier_user_id,shift_id,order_type,order_source,customer_name,customer_phone,table_number,guest_count,pickup_time,notes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(req.user.id,shift?.id||null,orderType,orderSource,b.customerName||null,b.customerPhone||null,b.tableNumber||null,b.guestCount==null?null:integer(b.guestCount,'guestCount',1),b.pickupTime||null,b.notes||null);send(res,getSale(Number(r.lastInsertRowid)),201);});
route('get','/sales/:id',authenticate,working,(req,res)=>{const sale=getSale(id(req));saleAllowed(req,sale);send(res,sale);});
route('patch','/sales/:id',authenticate,working,(req,res)=>{const sale=getSale(id(req));saleAllowed(req,sale);if(sale.status!=='DRAFT')fail('Completed or cancelled sale is locked',409);const b=req.body,e={};const map={orderType:'order_type',orderSource:'order_source',customerName:'customer_name',customerPhone:'customer_phone',tableNumber:'table_number',guestCount:'guest_count',pickupTime:'pickup_time',notes:'notes',discountType:'discount_type',discountValue:'discount_value'};for(const [k,col] of Object.entries(map))if(b[k]!==undefined)e[col]=b[k];if(e.order_type)enumValue(e.order_type,['DINE_IN','TAKEAWAY'],'orderType');if(e.order_source)enumValue(e.order_source,['POS','PHONE'],'orderSource');if(e.discount_type)enumValue(e.discount_type,['NONE','FIXED','PERCENTAGE'],'discountType');if(e.discount_value!==undefined)integer(e.discount_value,'discountValue',0,(e.discount_type||sale.discount_type)==='PERCENTAGE'?10000:Number.MAX_SAFE_INTEGER);if(e.guest_count!=null)integer(e.guest_count,'guestCount',1);const source=e.order_source||sale.order_source;if(source==='PHONE'){required(e.customer_name??sale.customer_name,'customerName');required(e.customer_phone??sale.customer_phone,'customerPhone');}const keys=Object.keys(e);transaction(()=>{if(keys.length)db.prepare(`UPDATE sales SET ${keys.map(k=>`${k}=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...Object.values(e),sale.id);persistCalculation(sale.id);});send(res,getSale(sale.id));});
route('put','/sales/:id/items/:productId',authenticate,working,(req,res)=>{const sale=getSale(id(req));saleAllowed(req,sale);if(sale.status!=='DRAFT')fail('Sale is locked',409);const productId=integer(Number(req.params.productId),'productId',1),quantity=integer(req.body.quantity,'quantity',0,999);transaction(()=>{const existing=db.prepare('SELECT * FROM sale_items WHERE sale_id=? AND product_id=?').get(sale.id,productId);if(quantity===0){if(existing)db.prepare('DELETE FROM sale_items WHERE id=?').run(existing.id);}else if(existing){db.prepare('UPDATE sale_items SET quantity=? WHERE id=?').run(quantity,existing.id);}else{const p=db.prepare('SELECT p.*,c.name AS category_name FROM products p JOIN categories c ON c.id=p.category_id WHERE p.id=? AND p.is_active=1 AND p.deleted_at IS NULL AND c.is_active=1').get(productId);if(!p)fail('Active product not found',404);db.prepare('INSERT INTO sale_items(sale_id,product_id,product_name_snapshot,category_name_snapshot,unit_price_cents,quantity,line_subtotal_cents,line_total_cents) VALUES(?,?,?,?,?,?,?,?)').run(sale.id,p.id,p.name,p.category_name,p.price_cents,quantity,p.price_cents*quantity,p.price_cents*quantity);}persistCalculation(sale.id);});send(res,getSale(sale.id));});
route('delete','/sales/:id/items',authenticate,working,(req,res)=>{const sale=getSale(id(req));saleAllowed(req,sale);if(sale.status!=='DRAFT')fail('Sale is locked',409);transaction(()=>{db.prepare('DELETE FROM sale_items WHERE sale_id=?').run(sale.id);persistCalculation(sale.id);});send(res,getSale(sale.id));});
route('post','/sales/:id/cancel',authenticate,working,(req,res)=>{const sale=getSale(id(req));saleAllowed(req,sale);if(sale.status!=='DRAFT')fail('Sale is locked',409);db.prepare("UPDATE sales SET status='CANCELLED',cancelled_at=CURRENT_TIMESTAMP WHERE id=?").run(sale.id);audit(req.user.id,'SALE_CANCELLED','sales',sale.id);send(res,getSale(sale.id));});
route('post','/sales/:id/checkout',authenticate,working,(req,res)=>{
  const b=req.body,key=required(b.idempotencyKey,'idempotencyKey');if(key.length>100)fail('Idempotency key too long');
  const existing=db.prepare('SELECT id FROM sales WHERE idempotency_key=?').get(key);if(existing){if(existing.id!==id(req))fail('Idempotency key belongs to another sale',409);const prior=getSale(existing.id);saleAllowed(req,prior);return send(res,prior);}
  const method=enumValue(b.paymentMethod,['CASH','CREDIT_CARD','DEBIT_CARD','OTHER'],'paymentMethod');
  const result=transaction(()=>{
    const sale=getSale(id(req));saleAllowed(req,sale);if(sale.status!=='DRAFT')fail('Sale is locked',409);if(!sale.items.length)fail('Bill is empty');
    const bill=persistCalculation(sale.id);const cash=method==='CASH'?integer(b.cashReceivedCents,'cashReceivedCents'):null;
    if(method==='CASH'&&cash<bill.total_cents)fail('Insufficient cash received');
    const receipt='POS-'+String(sale.id+100000).padStart(6,'0');
    db.prepare("UPDATE sales SET status='COMPLETED',receipt_number=?,idempotency_key=?,completed_at=CURRENT_TIMESTAMP WHERE id=?").run(receipt,key,sale.id);
    db.prepare('INSERT INTO payments(sale_id,method,amount_cents,cash_received_cents,change_cents) VALUES(?,?,?,?,?)').run(sale.id,method,bill.total_cents,cash,cash==null?null:cash-bill.total_cents);
    audit(req.user.id,'SALE_COMPLETED','sales',sale.id,{receipt,method,totalCents:bill.total_cents});
    return getSale(sale.id);
  });
  const printReceipt=b.printReceipt===true;
  let printJob=null;
  if(printReceipt) { try { printJob=printSale(result.id,true); } catch(e) { /* Sale remains committed; print failure is separate. */ } }
  send(res,{...getSale(result.id),printJob});
});
route('get','/sales/:id/receipt',authenticate,working,(req,res)=>{const sale=getSale(id(req));saleAllowed(req,sale);if(sale.status!=='COMPLETED')fail('Sale not completed',409);res.type('text/plain').send(renderReceipt(sale));});
route('get','/sales/:id/receipt-preview',authenticate,working,(req,res)=>{const sale=getSale(id(req));saleAllowed(req,sale);if(sale.status!=='COMPLETED')fail('Sale not completed',409);send(res,{text:renderReceipt(sale)});});
route('post','/sales/:id/reprint',authenticate,working,(req,res)=>{const sale=getSale(id(req));saleAllowed(req,sale);if(sale.status!=='COMPLETED')fail('Sale not completed',409);const job=printSale(sale.id,true);audit(req.user.id,'RECEIPT_REPRINTED','sales',sale.id,{jobId:job.id});send(res,job);});
route('get','/sales/:id/print-jobs',authenticate,working,(req,res)=>{const sale=getSale(id(req));saleAllowed(req,sale);send(res,db.prepare('SELECT id,status,error_message,created_at,printed_at FROM print_jobs WHERE sale_id=? ORDER BY id DESC LIMIT 10').all(sale.id));});
route('get','/payments',authenticate,admin,(req,res)=>send(res,db.prepare('SELECT * FROM payments ORDER BY id DESC LIMIT 500').all()));
function reportRange(req) {
  const today=deviceDate(),from=req.query.from||today,to=req.query.to||today;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)fail('Invalid date range');
  return {from,to};
}
function salesReport(from,to) {
  const args=[from,to], where="status='COMPLETED' AND date(completed_at,'localtime') BETWEEN ? AND ?";
  const totals=db.prepare(`SELECT COUNT(*) AS orders,COALESCE(SUM(subtotal_cents),0) AS subtotal_cents,COALESCE(SUM(discount_cents),0) AS discount_cents,COALESCE(SUM(tax_cents),0) AS tax_cents,COALESCE(SUM(total_cents),0) AS revenue_cents FROM sales WHERE ${where}`).get(...args);
  const orderTypes=db.prepare(`SELECT order_type,COUNT(*) AS orders,SUM(total_cents) AS revenue_cents FROM sales WHERE ${where} GROUP BY order_type`).all(...args);
  const orderSources=db.prepare(`SELECT order_source,COUNT(*) AS orders,SUM(total_cents) AS revenue_cents FROM sales WHERE ${where} GROUP BY order_source`).all(...args);
  const payments=db.prepare("SELECT p.method,COUNT(*) AS orders,SUM(p.amount_cents) AS revenue_cents FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.status='COMPLETED' AND date(s.completed_at,'localtime') BETWEEN ? AND ? GROUP BY p.method").all(...args);
  return {from,to,totals,orderTypes,orderSources,payments};
}
route('get','/reports/sales',authenticate,admin,(req,res)=>{const {from,to}=reportRange(req);send(res,salesReport(from,to));});
route('get','/reports/today',authenticate,admin,(req,res)=>{const today=deviceDate();send(res,salesReport(today,today));});
route('get','/reports/products',authenticate,admin,(req,res)=>{const {from,to}=reportRange(req);send(res,db.prepare("SELECT si.product_name_snapshot AS name,SUM(si.quantity) AS quantity_sold,SUM(si.line_total_cents) AS revenue_cents FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.status='COMPLETED' AND date(s.completed_at,'localtime') BETWEEN ? AND ? GROUP BY si.product_name_snapshot ORDER BY quantity_sold DESC").all(from,to));});
route('get','/reports/categories',authenticate,admin,(req,res)=>{const {from,to}=reportRange(req);send(res,db.prepare("SELECT si.category_name_snapshot AS name,SUM(si.quantity) AS items_sold,SUM(si.line_total_cents) AS revenue_cents FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.status='COMPLETED' AND date(s.completed_at,'localtime') BETWEEN ? AND ? GROUP BY si.category_name_snapshot ORDER BY revenue_cents DESC").all(from,to));});
route('get','/reports/tax',authenticate,admin,(req,res)=>{const {from,to}=reportRange(req);send(res,db.prepare("SELECT COALESCE(SUM(CASE WHEN si.tax_rate_snapshot>0 THEN si.line_subtotal_cents-si.discount_cents ELSE 0 END),0) AS taxable_sales_cents,COALESCE(SUM(CASE WHEN si.tax_rate_snapshot=0 THEN si.line_subtotal_cents-si.discount_cents ELSE 0 END),0) AS exempt_sales_cents,COALESCE(SUM(si.tax_cents),0) AS tax_collected_cents FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.status='COMPLETED' AND date(s.completed_at,'localtime') BETWEEN ? AND ?").get(from,to));});
route('get','/reports/discounts',authenticate,admin,(req,res)=>{const {from,to}=reportRange(req);send(res,db.prepare("SELECT discount_type,COUNT(*) AS orders,COALESCE(SUM(discount_cents),0) AS discount_cents FROM sales WHERE status='COMPLETED' AND discount_cents>0 AND date(completed_at,'localtime') BETWEEN ? AND ? GROUP BY discount_type").all(from,to));});
route('get','/reports/cashiers',authenticate,admin,(req,res)=>{const {from,to}=reportRange(req);send(res,db.prepare("SELECT u.username,COUNT(s.id) AS orders,COALESCE(SUM(s.total_cents),0) AS revenue_cents,COALESCE(SUM(CASE WHEN p.method='CASH' THEN p.amount_cents ELSE 0 END),0) AS cash_cents,COALESCE(SUM(CASE WHEN p.method IN ('CREDIT_CARD','DEBIT_CARD') THEN p.amount_cents ELSE 0 END),0) AS card_cents FROM sales s JOIN users u ON u.id=s.cashier_user_id JOIN payments p ON p.sale_id=s.id WHERE s.status='COMPLETED' AND date(s.completed_at,'localtime') BETWEEN ? AND ? GROUP BY s.cashier_user_id ORDER BY revenue_cents DESC").all(from,to));});
route('get','/reports/export.csv',authenticate,admin,(req,res)=>{const {from,to}=reportRange(req);const rows=db.prepare("SELECT s.receipt_number,s.completed_at,u.username AS cashier,s.order_type,s.order_source,s.customer_name,s.customer_phone,s.subtotal_cents,s.discount_cents,s.tax_cents,s.total_cents,p.method FROM sales s JOIN users u ON u.id=s.cashier_user_id JOIN payments p ON p.sale_id=s.id WHERE s.status='COMPLETED' AND date(s.completed_at,'localtime') BETWEEN ? AND ? ORDER BY s.id").all(from,to);const cols=['receipt_number','completed_at','cashier','order_type','order_source','customer_name','customer_phone','subtotal_cents','discount_cents','tax_cents','total_cents','method'];const csv=[cols.join(','),...rows.map(row=>cols.map(k=>'"'+String((k==='completed_at'?deviceDateTime(row[k]):row[k])??'').replaceAll('"','""')+'"').join(','))].join('\r\n');res.set('Content-Disposition',`attachment; filename="sales-${from}-${to}.csv"`).type('text/csv').send(csv);});

route('get','/printer',authenticate,working,(req,res)=>send(res,db.prepare('SELECT * FROM printer_settings ORDER BY id').all()));
route('get','/printer/devices',authenticate,working,async(req,res)=>send(res,await listSystemPrinters()));
route('post','/printer/connect',authenticate,admin,async(req,res)=>{
  const name=required(req.body.name,'name');
  const available=(await listSystemPrinters()).find(item=>item.name===name);
  if(!available)fail('Printer is not installed in Windows. Pair or connect it in Windows settings first.',404);
  const width=enumValue(req.body.receiptWidth||80,[58,80],'receiptWidth');
  const item=transaction(()=>{
    db.prepare('UPDATE printer_settings SET is_active=0').run();
    const old=db.prepare('SELECT id FROM printer_settings WHERE device_identifier=?').get(name);
    if(old)db.prepare('UPDATE printer_settings SET name=?,connection_type=?,receipt_width=?,is_active=1,auto_print=0 WHERE id=?').run(name,available.connectionType,width,old.id);
    else db.prepare('INSERT INTO printer_settings(name,connection_type,receipt_width,device_identifier,auto_print,is_active) VALUES(?,?,?,?,0,1)').run(name,available.connectionType,width,name);
    const active=db.prepare('SELECT * FROM printer_settings WHERE is_active=1 LIMIT 1').get();
    audit(req.user.id,'PRINTER_CONNECTED','printer_settings',active.id,{name});return active;
  });
  send(res,{...item,device:available});
});
route('post','/printer/disconnect',authenticate,admin,(req,res)=>{const active=db.prepare('SELECT * FROM printer_settings WHERE is_active=1 LIMIT 1').get();if(active){db.prepare('UPDATE printer_settings SET is_active=0 WHERE id=?').run(active.id);audit(req.user.id,'PRINTER_DISCONNECTED','printer_settings',active.id);}send(res,{ok:true});});
route('post','/printer/test',authenticate,working,async(req,res)=>{const active=db.prepare('SELECT * FROM printer_settings WHERE is_active=1 LIMIT 1').get();if(!active)fail('No printer connected',409);try{send(res,await testPrinter(active));}catch(error){fail(`Test print failed: ${error.message}`,502);}});
route('post','/printer',authenticate,admin,(req,res)=>{const b=req.body;const type=enumValue(b.connectionType,['USB','BLUETOOTH','NETWORK','SYSTEM'],'connectionType');const r=db.prepare('INSERT INTO printer_settings(name,connection_type,receipt_width,device_identifier,ip_address,port,auto_print,copies,is_active) VALUES(?,?,?,?,?,?,?,?,?)').run(required(b.name,'name'),type,enumValue(b.receiptWidth||80,[58,80],'receiptWidth'),b.deviceIdentifier||null,b.ipAddress||null,b.port||null,b.autoPrint===false?0:1,integer(b.copies||1,'copies',1,5),b.isActive===false?0:1);audit(req.user.id,'PRINTER_CREATED','printer_settings',Number(r.lastInsertRowid));send(res,db.prepare('SELECT * FROM printer_settings WHERE id=?').get(r.lastInsertRowid),201);});
route('patch','/printer/:id',authenticate,admin,(req,res)=>{const b=req.body,e={};const map={name:'name',connectionType:'connection_type',receiptWidth:'receipt_width',deviceIdentifier:'device_identifier',ipAddress:'ip_address',port:'port',autoPrint:'auto_print',copies:'copies',isActive:'is_active'};for(const [k,col] of Object.entries(map))if(b[k]!==undefined)e[col]=['autoPrint','isActive'].includes(k)?bool(b[k]):b[k];if(e.connection_type)enumValue(e.connection_type,['USB','BLUETOOTH','NETWORK','SYSTEM'],'connectionType');if(e.receipt_width)enumValue(e.receipt_width,[58,80],'receiptWidth');const keys=Object.keys(e);if(keys.length)db.prepare(`UPDATE printer_settings SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=?`).run(...Object.values(e),id(req));audit(req.user.id,'PRINTER_UPDATED','printer_settings',id(req),{fields:keys});send(res,db.prepare('SELECT * FROM printer_settings WHERE id=?').get(id(req)));});
route('get','/printer/jobs',authenticate,admin,(req,res)=>send(res,db.prepare('SELECT * FROM print_jobs ORDER BY id DESC LIMIT 100').all()));
route('get','/settings',authenticate,admin,(req,res)=>send(res,Object.fromEntries(db.prepare('SELECT key,value FROM app_settings').all().map(x=>[x.key,x.value]))));
route('patch','/settings',authenticate,admin,(req,res)=>{for(const key of ['auto_backup','backup_keep'])if(req.body[key]!==undefined){const value=key==='auto_backup'?(req.body[key]?'true':'false'):String(integer(req.body[key],key,1,365));db.prepare('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}audit(req.user.id,'SETTINGS_UPDATED','app_settings',null,{keys:Object.keys(req.body)});send(res,{ok:true});});
route('get','/backups',authenticate,admin,(req,res)=>send(res,listBackups()));
route('post','/backups',authenticate,admin,(req,res)=>{const result=createBackup();audit(req.user.id,'BACKUP_CREATED','backups',null,{filename:result.filename});send(res,result,201);});
route('post','/backups/restore',authenticate,admin,(req,res)=>{const filename=required(req.body.filename,'filename');const result=restoreBackup(filename);send(res,result);setTimeout(()=>process.exit(0),500);});
route('get','/audit-logs',authenticate,admin,(req,res)=>send(res,db.prepare('SELECT a.*,u.username FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500').all()));

app.get(/.*/,(req,res)=>res.sendFile(path.join(__dirname,'..','public','index.html')));
app.use((err,req,res,next)=>{if(res.headersSent)return next(err);const status=err.status||(/constraint|UNIQUE|FOREIGN KEY/i.test(err.message)?409:500);if(status>=500)console.error(err);res.status(status).json({error:status>=500?'Internal server error':err.message});});
if(require.main===module){const port=Number(process.env.PORT||5000);app.listen(port,'127.0.0.1',()=>console.log(`Offline POS: http://127.0.0.1:${port}`));const backupTimer=setInterval(()=>{try{automaticBackup();}catch(e){console.error('Automatic backup failed:',e.message);}},60*60*1000);backupTimer.unref();try{automaticBackup();}catch(e){console.error('Automatic backup failed:',e.message);}}
module.exports=app;
