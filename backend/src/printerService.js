const net = require('node:net');
const { spawn } = require('node:child_process');
const { db } = require('./db');
const money = cents => '$'+(cents/100).toFixed(2);
function renderReceipt(sale) {
  const business=db.prepare('SELECT * FROM businesses WHERE id=1').get();
  const width=db.prepare('SELECT receipt_width FROM printer_settings WHERE is_active=1 ORDER BY id LIMIT 1').get()?.receipt_width===58?32:48;
  const line='-'.repeat(width), lines=[business.name,business.address_line_1,[business.city,business.state,business.zip_code].filter(Boolean).join(' '),business.phone,line,`Receipt: ${sale.receipt_number}`,`Date: ${sale.completed_at}`,`Cashier: ${sale.cashier}`,`Order: ${sale.order_type} / ${sale.order_source}`];
  if(sale.table_number)lines.push(`Table: ${sale.table_number}`);
  if(sale.customer_name)lines.push(`Customer: ${sale.customer_name}`);
  if(sale.customer_phone)lines.push(`Phone: ${sale.customer_phone}`);
  lines.push(line);
  for(const item of sale.items)lines.push(`${item.quantity} x ${item.product_name_snapshot}  ${money(item.line_total_cents)}`);
  lines.push(line,`Subtotal: ${money(sale.subtotal_cents)}`,`Discount: -${money(sale.discount_cents)}`,`Tax: ${money(sale.tax_cents)}`,`TOTAL: ${money(sale.total_cents)}`,`Payment: ${sale.payment?.method}`);
  if(sale.payment?.method==='CASH')lines.push(`Received: ${money(sale.payment.cash_received_cents)}`,`Change: ${money(sale.payment.change_cents)}`);
  lines.push(line,business.receipt_footer||'', '', '');
  return lines.filter(x=>x!==undefined&&x!==null).flatMap(value=>{const text=String(value);if(!text)return [''];const chunks=[];for(let i=0;i<text.length;i+=width)chunks.push(text.slice(i,i+width));return chunks;}).join('\n');
}
class NetworkPrinterAdapter {
  static print(settings,text) { return new Promise((resolve,reject)=>{const socket=net.createConnection({host:settings.ip_address,port:settings.port||9100,timeout:4000},()=>socket.end(Buffer.concat([Buffer.from('\x1b\x40'),Buffer.from(text,'utf8'),Buffer.from('\n\n\x1d\x56\x00')])));socket.on('error',reject);socket.on('timeout',()=>socket.destroy(new Error('Printer timeout')));socket.on('close',hadError=>{if(!hadError)resolve();});}); }
}
class SystemPrinterAdapter {
  static print(settings,text) {
    if(process.platform!=='win32')throw new Error('System printing currently requires Windows');
    const name=settings.device_identifier||settings.name;
    if(!name)throw new Error('Windows printer name is required');
    return new Promise((resolve,reject)=>{
      const script="$ErrorActionPreference='Stop'; $text=[Console]::In.ReadToEnd(); $text | Out-Printer -Name $env:POS_PRINTER_NAME";
      const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,env:{...process.env,POS_PRINTER_NAME:name}});
      let error='';child.stderr.on('data',chunk=>error+=chunk.toString());
      child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(error.slice(0,300)||`Printer exited with code ${code}`)));
      child.stdin.end(text);
    });
  }
}
class USBPrinterAdapter extends SystemPrinterAdapter {}
class BluetoothPrinterAdapter extends SystemPrinterAdapter {}
const adapters={NETWORK:NetworkPrinterAdapter,USB:USBPrinterAdapter,BLUETOOTH:BluetoothPrinterAdapter,SYSTEM:SystemPrinterAdapter};
function listSystemPrinters() {
  if(process.platform!=='win32')return Promise.resolve([]);
  return new Promise((resolve,reject)=>{
    const script="$ErrorActionPreference='Stop'; Get-Printer | Select-Object Name,PortName,DriverName,@{Name='Status';Expression={$_.PrinterStatus.ToString()}} | ConvertTo-Json -Compress -Depth 3";
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true});
    let output='',error='';
    child.stdout.on('data',chunk=>output+=chunk);
    child.stderr.on('data',chunk=>error+=chunk);
    child.on('error',reject);
    child.on('close',code=>{
      if(code!==0)return reject(new Error(error.slice(0,300)||'Could not list Windows printers'));
      try {
        const items=output.trim()?JSON.parse(output):[];
        resolve((Array.isArray(items)?items:[items]).filter(item=>
          !/PORTPROMPT:|^nul:$/i.test(String(item.PortName||'')) &&
          !/Microsoft Print to PDF|Microsoft XPS|OneNote|Fax/i.test(String(item.Name||''))
        ).map(item=>{
          const port=String(item.PortName||'');
          const status=String(item.Status||'Unknown');
          return {name:item.Name,portName:port,driverName:item.DriverName,status,
            connectionType:/BTH|BLUETOOTH/i.test(port)?'BLUETOOTH':/USB|COM\d/i.test(port)?'USB':'SYSTEM',
            connected:!/OFFLINE|ERROR|PAPEROUT|TONER|DOOROPEN/i.test(status)};
        }));
      } catch(e) { reject(e); }
    });
  });
}
async function testPrinter(settings) {
  const business=db.prepare('SELECT name FROM businesses WHERE id=1').get()?.name||'Offline POS';
  const content=`${business}\nPRINTER TEST\n${new Date().toLocaleString()}\nConnection successful\n\n\n`;
  await adapters[settings.connection_type].print(settings,content);
  return {ok:true};
}
function printSale(saleId,manual=false) {
  const printer=db.prepare('SELECT * FROM printer_settings WHERE is_active=1 ORDER BY id LIMIT 1').get();
  const result=db.prepare('INSERT INTO print_jobs(sale_id,printer_id,copies) VALUES(?,?,?)').run(saleId,printer?.id||null,printer?.copies||1);
  const jobId=Number(result.lastInsertRowid);
  if(!printer){db.prepare("UPDATE print_jobs SET status='FAILED',attempts=1,error_message='No active printer configured' WHERE id=?").run(jobId);return db.prepare('SELECT * FROM print_jobs WHERE id=?').get(jobId);}
  if(!printer.auto_print&&!manual)return db.prepare('SELECT * FROM print_jobs WHERE id=?').get(jobId);
  const sale=db.prepare('SELECT s.*,u.username AS cashier FROM sales s JOIN users u ON u.id=s.cashier_user_id WHERE s.id=?').get(saleId);
  sale.items=db.prepare('SELECT * FROM sale_items WHERE sale_id=?').all(saleId);
  sale.payment=db.prepare('SELECT * FROM payments WHERE sale_id=?').get(saleId);
  const text=renderReceipt(sale);
  Promise.resolve().then(async()=>{for(let i=0;i<printer.copies;i++)await adapters[printer.connection_type].print(printer,text);db.prepare("UPDATE print_jobs SET status='PRINTED',attempts=attempts+1,printed_at=CURRENT_TIMESTAMP WHERE id=?").run(jobId);}).catch(e=>db.prepare("UPDATE print_jobs SET status='FAILED',attempts=attempts+1,error_message=? WHERE id=?").run(String(e.message).slice(0,300),jobId));
  return db.prepare('SELECT * FROM print_jobs WHERE id=?').get(jobId);
}
module.exports={renderReceipt,printSale,listSystemPrinters,testPrinter,NetworkPrinterAdapter,USBPrinterAdapter,BluetoothPrinterAdapter,SystemPrinterAdapter};
