// Web Bluetooth 设备连接（协议见 README「BLE 协议」）
const BASE = '-6c2e-4f1a-9d7e-2a5b9c4e1d00';
export const UUID = {
  service: '8b3f0001' + BASE,
  telemetry: '8b3f0002' + BASE,
  control: '8b3f0003' + BASE,
  profile: '8b3f0004' + BASE,
  info: '8b3f0005' + BASE,
};
export const OP = { MODE: 1, PREDICT: 2, SWAP: 3, MARKER: 4, MANUAL: 5, VENT: 6 };

export function parseTelemetry(dv) {
  return {
    seq: dv.getUint16(0, true),
    t: dv.getUint32(2, true),
    pAmb: dv.getUint32(6, true) / 100,
    dpL: dv.getInt16(10, true) / 10,
    dpR: dv.getInt16(12, true) / 10,
    dutyL: dv.getUint8(14),
    dutyR: dv.getUint8(15),
    predSlope: dv.getInt16(16, true) / 10,
    state: dv.getUint8(18),
    flags: dv.getUint8(19),
  };
}

export function encodeProfile(p) {
  const dv = new DataView(new ArrayBuffer(14));
  dv.setUint16(0, p.version & 0xffff, true);
  let o = 2;
  for (const s of ['L', 'R']) {
    dv.setUint16(o, Math.round(p[s].rateMax * 100), true);
    dv.setUint16(o + 2, Math.round(p[s].dpComfort * 100), true);
    dv.setUint16(o + 4, Math.round(p[s].lead * 10), true);
    o += 6;
  }
  return dv.buffer;
}

export const bleSupported = () => !!navigator.bluetooth;

export class BleDevice extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.ch = {};
    this.manual = false;
  }

  get connected() {
    return !!this.device?.gatt?.connected;
  }

  async connect() {
    if (!bleSupported()) throw new Error('当前浏览器不支持 Web Bluetooth，请使用安卓 Chrome');
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [UUID.service] }, { namePrefix: 'AeroEar' }],
      optionalServices: [UUID.service, 'battery_service'],
    });
    this.device.addEventListener('gattserverdisconnected', () => this.onDisconnect());
    this.manual = false;
    await this.setup();
  }

  async setup() {
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService(UUID.service);
    this.ch.tx = await svc.getCharacteristic(UUID.telemetry);
    this.ch.ctrl = await svc.getCharacteristic(UUID.control);
    this.ch.profile = await svc.getCharacteristic(UUID.profile).catch(() => null);
    this.ch.info = await svc.getCharacteristic(UUID.info).catch(() => null);
    this.ch.tx.addEventListener('characteristicvaluechanged', (e) => {
      if (e.target.value.byteLength < 20) return;
      this.dispatchEvent(new CustomEvent('sample', { detail: parseTelemetry(e.target.value) }));
    });
    await this.ch.tx.startNotifications();
    const info = await this.readInfo();
    this.dispatchEvent(new CustomEvent('connected', { detail: { name: this.device.name || 'AeroEar', ...info } }));
  }

  async readInfo() {
    if (!this.ch.info) return {};
    try {
      const v = await this.ch.info.readValue();
      const battery = v.getUint8(0);
      const fw = new TextDecoder().decode(new Uint8Array(v.buffer, v.byteOffset + 1, v.byteLength - 1));
      return { battery, fw };
    } catch {
      return {};
    }
  }

  async onDisconnect() {
    this.dispatchEvent(new Event('disconnected'));
    if (this.manual || !this.device) return;
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      if (this.manual) return;
      try {
        await this.setup();
        return;
      } catch {
        /* 继续重试 */
      }
    }
  }

  async write(ch, buf) {
    if (!this.connected || !ch) return false;
    if (ch.writeValueWithResponse) await ch.writeValueWithResponse(buf);
    else await ch.writeValue(buf);
    return true;
  }

  send(op, ...bytes) {
    return this.write(this.ch.ctrl, new Uint8Array([op, ...bytes]));
  }

  writeProfile(p) {
    return this.write(this.ch.profile, encodeProfile(p));
  }

  disconnect() {
    this.manual = true;
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
  }
}
