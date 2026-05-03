'use client';

/* ------------------------------------------------------------------ */
/*  Web Serial API type declarations (not bundled with Next.js/TS)   */
/* ------------------------------------------------------------------ */

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialOptions {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space';
  flowControl?: 'none' | 'hardware';
  bufferSize?: number;
}

interface SerialPort {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  readonly info: SerialPortInfo;

  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  forget(): Promise<void>;
  setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  getSignals(): Promise<{ dataTerminalReady: boolean; clearToSend: boolean; ringIndicator: boolean; dataCarrierDetect: boolean; dataSetReady: boolean }>;

  addEventListener(type: 'connect' | 'disconnect', listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: 'connect' | 'disconnect', listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}

interface SerialPortRequestOptions {
  filters?: Array<{ usbVendorId?: number; usbProductId?: number }>;
  allowedBluetoothServiceIds?: Array<string>;
}

interface Serial {
  getPorts(): Promise<SerialPort[]>;
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  addEventListener(type: 'connect' | 'disconnect', listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: 'connect' | 'disconnect', listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}

// Extend Navigator with serial property for TypeScript
declare global {
  interface Navigator {
    readonly serial: Serial;
  }
}

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export type PrinterStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface PrinterStatusChange {
  status: PrinterStatus;
  portInfo: SerialPortInfo | null;
  error?: string;
}

export type OnStatusChangeCallback = (change: PrinterStatusChange) => void;
export type OnErrorCallback = (error: Error) => void;

export interface USBPrinterState {
  connected: boolean;
  status: PrinterStatus;
  portInfo: SerialPortInfo | null;
  lastError: string | null;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const BAUD_RATE = 9600;
const DATA_BITS = 8;
const STOP_BITS = 1;
const PARITY: SerialOptions['parity'] = 'none';
const FLOW_CONTROL: SerialOptions['flowControl'] = 'none';

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

/* ------------------------------------------------------------------ */
/*  USBPrinterManager                                                  */
/* ------------------------------------------------------------------ */

export class USBPrinterManager {
  /* ---- state ---- */
  private port: SerialPort | null = null;
  private _status: PrinterStatus = 'disconnected';
  private _lastError: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private keepAliveAbort: AbortController | null = null;
  private destroyed = false;

  /* ---- callbacks ---- */
  private statusChangeCallbacks: Set<OnStatusChangeCallback> = new Set();
  private errorCallbacks: Set<OnErrorCallback> = new Set();

  /* ================================================================ */
  /*  Observer registration                                            */
  /* ================================================================ */

  onStatusChange(cb: OnStatusChangeCallback): () => void {
    this.statusChangeCallbacks.add(cb);
    return () => this.statusChangeCallbacks.delete(cb);
  }

  onError(cb: OnErrorCallback): () => void {
    this.errorCallbacks.add(cb);
    return () => this.errorCallbacks.delete(cb);
  }

  /* ================================================================ */
  /*  Port discovery                                                   */
  /* ================================================================ */

  /**
   * Return previously-authorised ports without showing a picker.
   */
  async autoDetect(): Promise<SerialPort[]> {
    this.guardSerialSupported();
    return navigator.serial.getPorts();
  }

  /**
   * Open the browser serial-port picker so the user can select a printer.
   */
  async requestPrinter(): Promise<SerialPort> {
    this.guardSerialSupported();
    const port = await navigator.serial.requestPort();
    this.port = port;
    return port;
  }

  /* ================================================================ */
  /*  Connection lifecycle                                             */
  /* ================================================================ */

  /**
   * Connect to `port` (or the currently stored port).
   * Opens the serial connection and starts a keep-alive reader.
   */
  async connect(port?: SerialPort): Promise<void> {
    this.guardSerialSupported();

    if (this._status === 'connected' || this._status === 'connecting') {
      return;
    }

    const target = port ?? this.port;
    if (!target) {
      throw new Error('No port available. Call requestPrinter() or autoDetect() first.');
    }

    this.port = target;
    this.setStatus('connecting');

    try {
      await target.open({
        baudRate: BAUD_RATE,
        dataBits: DATA_BITS,
        stopBits: STOP_BITS,
        parity: PARITY,
        flowControl: FLOW_CONTROL,
      });

      this.resetReconnectState();
      this.setStatus('connected');
      this.startKeepAlive();

      // Listen for hardware disconnect events
      target.addEventListener('disconnect', this.handleDisconnect);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._lastError = message;
      this.setStatus('error', message);
      this.emitError(err instanceof Error ? err : new Error(message));
      throw err;
    }
  }

  /**
   * Clean disconnect — stops keep-alive, closes the port, removes listeners.
   */
  async disconnect(): Promise<void> {
    this.stopReconnect();
    this.stopKeepAlive();

    if (this.port) {
      try {
        this.port.removeEventListener('disconnect', this.handleDisconnect);
        if (this.port.readable) {
          await this.port.close();
        } else {
          // If readable is already unlocked we can still attempt close
          await this.port.close().catch(() => {});
        }
      } catch {
        // Swallow errors during disconnect — best-effort cleanup
      }
      this.port = null;
    }

    this.resetReconnectState();
    this.setStatus('disconnected');
  }

  /* ================================================================ */
  /*  Printing                                                         */
  /* ================================================================ */

  /**
   * Send raw ESC/POS byte data to the printer.
   */
  async print(data: Uint8Array): Promise<void> {
    if (!this.port || this._status !== 'connected') {
      throw new Error('Printer is not connected.');
    }

    if (!this.port.writable) {
      throw new Error('Printer port is not writable. The connection may have dropped.');
    }

    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

    try {
      writer = this.port.writable.getWriter();
      await writer.write(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._lastError = `Write failed: ${message}`;

      // If the write fails the port is likely disconnected
      this.setStatus('error', this._lastError);
      this.emitError(err instanceof Error ? err : new Error(this._lastError));
      throw err;
    } finally {
      try {
        if (writer) {
          writer.releaseLock();
        }
      } catch {
        // Ignore release errors
      }
    }
  }

  /**
   * Convenience: wrap plain-text receipt with ESC/POS framing and print it.
   */
  async printReceipt(receiptText: string): Promise<void> {
    // Dynamic import keeps the module tree-split friendly and avoids
    // pulling server-only code into the client bundle at parse-time.
    const { wrapReceiptWithESCPOS } = await import(
      /* webpackChunkName: "invoice-utils" */ './generate-invoice-pdf'
    );

    const data = wrapReceiptWithESCPOS(receiptText);
    await this.print(data);
  }

  /* ================================================================ */
  /*  Status helpers                                                   */
  /* ================================================================ */

  getStatus(): USBPrinterState {
    return {
      connected: this._status === 'connected',
      status: this._status,
      portInfo: this.port?.info ?? null,
      lastError: this._lastError,
    };
  }

  /* ================================================================ */
  /*  Lifecycle / cleanup                                              */
  /* ================================================================ */

  /**
   * Stop everything and release all references.
   */
  destroy(): void {
    this.destroyed = true;
    this.disconnect(); // fire-and-forget — best-effort cleanup
    this.statusChangeCallbacks.clear();
    this.errorCallbacks.clear();
  }

  /* ================================================================ */
  /*  Internals                                                        */
  /* ================================================================ */

  /* ---- guard ---- */

  private guardSerialSupported(): void {
    if (typeof navigator === 'undefined' || !('serial' in navigator)) {
      throw new Error(
        'Web Serial API is not supported in this browser. ' +
          'Use Chrome 89+ or Edge 89+ on desktop.',
      );
    }
  }

  /* ---- status management ---- */

  private setStatus(status: PrinterStatus, error?: string): void {
    this._status = status;
    if (error !== undefined) {
      this._lastError = error;
    }

    const change: PrinterStatusChange = {
      status,
      portInfo: this.port?.info ?? null,
      error: this._lastError ?? undefined,
    };

    for (const cb of this.statusChangeCallbacks) {
      try {
        cb(change);
      } catch {
        // Swallow callback errors
      }
    }
  }

  private emitError(err: Error): void {
    for (const cb of this.errorCallbacks) {
      try {
        cb(err);
      } catch {
        // Swallow callback errors
      }
    }
  }

  /* ---- disconnect handler (bound reference for addEventListener) ---- */

  private handleDisconnect = (): void => {
    this.stopKeepAlive();

    if (this.port) {
      try {
        this.port.removeEventListener('disconnect', this.handleDisconnect);
      } catch {
        // Ignore
      }
    }

    // Attempt auto-reconnect unless the manager was explicitly destroyed
    if (!this.destroyed) {
      this.setStatus('disconnected');
      this.scheduleReconnect();
    }
  };

  /* ---- keep-alive reader ---- */

  /**
   * Continuously reads from the serial port.
   * If the read throws (which happens on disconnect), the keep-alive
   * loop ends and `handleDisconnect` is invoked.
   */
  private startKeepAlive(): void {
    this.stopKeepAlive();

    if (!this.port?.readable) {
      return;
    }

    this.keepAliveAbort = new AbortController();
    const { signal } = this.keepAliveAbort;

    const run = async (): Promise<void> => {
      try {
        const reader = this.port!.readable!.getReader();

        try {
          while (true) {
            if (signal.aborted) break;

            // Attempting to read will resolve when data arrives or throw
            // when the device disconnects — exactly what we want.
            const { value, done } = await reader.read();

            if (done || signal.aborted) {
              break;
            }

            // We don't care about the data itself — thermal printers
            // send very little back. This loop exists solely to detect
            // when the stream closes (i.e. the cable is unplugged).
            if (value) {
              // Consume the data silently
            }
          }
        } finally {
          reader.releaseLock();
        }
      } catch {
        // A read error almost always means the device was disconnected.
        if (!this.destroyed) {
          this.handleDisconnect();
        }
      }
    };

    run(); // fire-and-forget
  }

  private stopKeepAlive(): void {
    if (this.keepAliveAbort) {
      this.keepAliveAbort.abort();
      this.keepAliveAbort = null;
    }
  }

  /* ---- reconnect logic ---- */

  private scheduleReconnect(): void {
    if (this.destroyed) return;

    this.reconnectAttempt++;

    if (this.reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
      const msg = `Auto-reconnect failed after ${MAX_RECONNECT_ATTEMPTS} attempts. Please reconnect manually.`;
      this._lastError = msg;
      this.setStatus('error', msg);
      this.emitError(new Error(msg));
      return;
    }

    const remaining = MAX_RECONNECT_ATTEMPTS - this.reconnectAttempt;
    const msg = `Printer disconnected. Reconnecting in ${RECONNECT_DELAY_MS / 1000}s… (attempt ${this.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS}, ${remaining} remaining)`;
    this._lastError = msg;
    this.setStatus('connecting'); // communicating intent to the UI

    this.reconnectTimer = setTimeout(async () => {
      if (this.destroyed) return;

      try {
        // Only attempt if we still have a port reference
        if (this.port) {
          await this.port.forget().catch(() => {});
        }

        // Try to get previously authorised ports first
        const ports = await navigator.serial.getPorts().catch(() => [] as SerialPort[]);
        if (ports.length > 0) {
          this.port = ports[0];
        }

        if (this.port) {
          await this.connect(this.port);
        } else {
          // No stored port — give up
          this._lastError = 'No previously authorised printer found for reconnect.';
          this.setStatus('error', this._lastError);
        }
      } catch (err) {
        // Reconnect attempt failed — schedule next one
        const message = err instanceof Error ? err.message : String(err);
        this._lastError = `Reconnect attempt ${this.reconnectAttempt} failed: ${message}`;

        if (!this.destroyed) {
          this.scheduleReconnect();
        }
      }
    }, RECONNECT_DELAY_MS);
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.resetReconnectState();
  }

  private resetReconnectState(): void {
    this.reconnectAttempt = 0;
    this._lastError = null;
  }
}

/* ------------------------------------------------------------------ */
/*  Singleton instance                                                 */
/* ------------------------------------------------------------------ */

export const usbPrinterManager = new USBPrinterManager();

export default usbPrinterManager;
