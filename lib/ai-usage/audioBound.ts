/** Parse actual local packet/frame lengths, not user-provided duration metadata. */
export function audioDurationBound(bytes: Uint8Array): number | null {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.length >= 44 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WAVE') {
    let bytesPerSecond = 0;
    let audioBytes = 0;
    for (let offset = 12; offset + 8 <= data.length;) {
      const size = data.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (start + size > data.length) return null;
      const kind = data.toString('ascii', offset, offset + 4);
      if (kind === 'fmt ') {
        if (bytesPerSecond) return null;
        if (size < 16) return null;
        const format = data.readUInt16LE(start), channels = data.readUInt16LE(start + 2);
        const rate = data.readUInt32LE(start + 4), width = data.readUInt16LE(start + 14);
        if (![1, 3].includes(format) || ![1, 2].includes(channels) || rate < 8000 || rate > 192000 || ![8, 16, 24, 32].includes(width)) return null;
        bytesPerSecond = rate * channels * width / 8;
      }
      if (kind === 'data') {
        if (!bytesPerSecond) return null;
        audioBytes += size;
      }
      offset = start + size + (size % 2);
    }
    return bytesPerSecond && audioBytes ? Math.ceil(audioBytes / bytesPerSecond) + 1 : null;
  }

  // WhatsApp voice notes are Ogg Opus. Sum Opus TOC frame durations (RFC 6716 §3.1),
  // rather than trusting Ogg granule timestamps, which may be incorrect or forged.
  if (data.toString('ascii', 0, 4) !== 'OggS') return null;
  let offset = 0, serial: number | undefined, samples = 0, packetIndex = 0;
  let pieces: Buffer[] = [];
  while (offset < data.length) {
    if (offset + 27 > data.length || data.toString('ascii', offset, offset + 4) !== 'OggS' || data[offset + 4] !== 0) return null;
    const currentSerial = data.readUInt32LE(offset + 14);
    if (serial !== undefined && serial !== currentSerial) return null;
    serial = currentSerial;
    const segments = data[offset + 26], headerEnd = offset + 27 + segments;
    if (headerEnd > data.length) return null;
    let cursor = headerEnd;
    for (let n = 0; n < segments; n++) {
      const length = data[offset + 27 + n];
      if (cursor + length > data.length) return null;
      pieces.push(data.subarray(cursor, cursor + length)); cursor += length;
      if (length === 255) continue;
      const packet = Buffer.concat(pieces); pieces = [];
      if (packetIndex === 0) {
        if (packet.length < 19 || packet.toString('ascii', 0, 8) !== 'OpusHead' || ![1, 2].includes(packet[9])) return null;
      } else if (packetIndex === 1) {
        if (packet.toString('ascii', 0, 8) !== 'OpusTags') return null;
      } else {
        if (packet.length < 1) return null;
        const config = packet[0] >> 3, code = packet[0] & 3;
        const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 0) & 63 : 2;
        const frameSamples = config >= 16 ? 120 << (config & 3) : config >= 12 ? 480 << (config & 1) : (config & 3) === 3 ? 2880 : 480 << (config & 3);
        if (frames < 1 || frames * frameSamples > 5760) return null;
        samples += frames * frameSamples;
      }
      packetIndex++;
    }
    offset = cursor;
  }
  return pieces.length === 0 && samples > 0 ? Math.ceil(samples / 48000) + 1 : null;
}
