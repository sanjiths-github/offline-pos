const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCupsPrinters } = require('../src/cupsPrinter');

test('CUPS queues map to the printer details shown in the POS', () => {
  const printers = parseCupsPrinters(
    'Receipt_USB\nReceipt_BT\n',
    'printer Receipt_USB is idle. enabled since Thu\nprinter Receipt_BT disabled since Thu\n',
    'device for Receipt_USB: usb://Epson/TM-T20\ndevice for Receipt_BT: bluetooth://printer\n'
  );
  assert.equal(printers.length, 2);
  assert.equal(printers[0].connectionType, 'USB');
  assert.equal(printers[0].connected, true);
  assert.equal(printers[1].connectionType, 'BLUETOOTH');
  assert.equal(printers[1].connected, false);
});
