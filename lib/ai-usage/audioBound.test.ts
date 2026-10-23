import { describe, expect, it } from 'vitest';
import { audioDurationBound } from './audioBound';

function wav(seconds: number): Buffer {
  const data = Buffer.alloc(44 + seconds * 16000 * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(data.length - 44, 40); return data;
}
function ogg(packets: Buffer[]): Buffer {
  const header = Buffer.alloc(27 + packets.length);
  header.write('OggS', 0); header.writeUInt32LE(7, 14); header[26] = packets.length;
  packets.forEach((packet, index) => { header[27 + index] = packet.length; });
  return Buffer.concat([header, ...packets]);
}
describe('local duration reservation', () => {
  it('bounds PCM by its actual data length, ignoring forged byte-rate metadata', () => {
    const value = wav(10); value.writeUInt32LE(1, 28);
    expect(audioDurationBound(value)).toBe(11);
  });
  it('rejects truncated and unsupported audio before provider dispatch', () => {
    expect(audioDurationBound(wav(10).subarray(0, 100))).toBeNull();
    expect(audioDurationBound(Buffer.from('unknown audio'))).toBeNull();
  });
  it('counts Opus packet frames rather than a forged Ogg granule position', () => {
    const head = Buffer.alloc(19); head.write('OpusHead'); head[9] = 1;
    const value = ogg([head, Buffer.from('OpusTags'), Buffer.from([0xf8, 1]), Buffer.from([0xf8, 1])]);
    value.writeBigUInt64LE(999999999n, 6);
    expect(audioDurationBound(value)).toBe(2);
  });
  it('rejects packets claiming more than the Opus 120ms maximum', () => {
    const head = Buffer.alloc(19); head.write('OpusHead'); head[9] = 1;
    expect(audioDurationBound(ogg([head, Buffer.from('OpusTags'), Buffer.from([0xfb, 63])]))).toBeNull();
  });
});
