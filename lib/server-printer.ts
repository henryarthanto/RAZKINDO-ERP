// =====================================================================
// SERVER-SIDE USB PRINTER — For STB deployment
//
// Prints directly to USB thermal printer via /dev/usb/lp0 or /dev/ttyUSB0.
// Used when the ERP is running on STB with a locally-connected printer.
//
// This bypasses Web Serial API (browser-only) and writes ESC/POS data
// directly to the USB device from the server side.
//
// Exports:
//   printToUSB(data: Uint8Array)  — send raw bytes to printer
//   getPrinterInfo()              — detect connected printer
// =====================================================================

import { promises as fsp, existsSync, accessSync, constants } from 'fs';
import { join } from 'path';

// Possible USB printer device paths on Linux
const PRINTER_DEVICES = [
  '/dev/usb/lp0',
  '/dev/usb/lp1',
  '/dev/ttyUSB0',
  '/dev/ttyUSB1',
  '/dev/ttyACM0',
  '/dev/ttyACM1',
];

let _printerDevice: string | null = null;

/**
 * Detect the USB printer device path.
 * Returns the first found device from the known paths.
 */
export function getPrinterDevice(): string | null {
  if (_printerDevice) return _printerDevice;

  for (const dev of PRINTER_DEVICES) {
    if (existsSync(dev)) {
      try {
        // Check if writable
        accessSync(dev, constants.W_OK);
        _printerDevice = dev;
        return dev;
      } catch {
        // Not writable — skip
      }
    }
  }
  return null;
}

/**
 * Get printer information for display.
 */
export async function getPrinterInfo(): Promise<{
  connected: boolean;
  device: string | null;
  devices: string[];
}> {
  const devices: string[] = [];
  for (const dev of PRINTER_DEVICES) {
    if (existsSync(dev)) {
      devices.push(dev);
    }
  }

  const device = getPrinterDevice();
  return {
    connected: !!device,
    device,
    devices,
  };
}

/**
 * Print raw ESC/POS data to the USB printer.
 * Opens the device, writes data, and closes.
 *
 * @param data - ESC/POS formatted byte array
 * @param devicePath - Optional explicit device path (auto-detects if not provided)
 */
export async function printToUSB(
  data: Uint8Array,
  devicePath?: string
): Promise<{ success: boolean; error?: string; bytesWritten?: number }> {
  const device = devicePath || getPrinterDevice();

  if (!device) {
    return {
      success: false,
      error: `No USB printer found. Checked: ${PRINTER_DEVICES.join(', ')}`,
    };
  }

  try {
    // Open device for writing
    const handle = await fsp.open(device, 'w');
    try {
      await handle.write(data);
      return {
        success: true,
        bytesWritten: data.length,
      };
    } finally {
      await handle.close();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Failed to write to ${device}: ${message}`,
    };
  }
}

/**
 * Print a receipt text string to the USB printer.
 * Wraps the text with ESC/POS commands automatically.
 *
 * @param receiptText - Plain text receipt (with \n line endings)
 * @param devicePath - Optional explicit device path
 */
export async function printReceiptToUSB(
  receiptText: string,
  devicePath?: string
): Promise<{ success: boolean; error?: string; bytesWritten?: number }> {
  const { wrapReceiptWithESCPOS } = await import('./generate-invoice-pdf');
  const data = wrapReceiptWithESCPOS(receiptText);
  return printToUSB(data, devicePath);
}
