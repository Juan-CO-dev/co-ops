import { describe, expect, it } from 'vitest';
import { assertVideo, CUT, SOURCE_SHA256 } from '../../scripts/assets/export-subdex.mjs';

const valid = () => ({ streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 720, height: 720 }], format: { duration: '0.9' } });
describe('SUBDEX existing drawn excerpt contract', () => {
  it('pins approved original and inspected cut excluding held-item cards and baked text', () => {
    expect(SOURCE_SHA256).toBe('332643dcbff5eb90e1e862d20bc2b9aa9b09ca99f25376f7d92d11e5f5abad82');
    expect(CUT).toEqual({ start: 17.3, duration: 0.9, poster: 17.5, crop: [0, 780, 1080, 1080], width: 720, height: 720 });
  });
  it('accepts opaque H264 under one MB', () => expect(() => assertVideo(valid(), 999999)).not.toThrow());
  it('rejects audio, alpha format, wrong codec, dimensions, duration and budget', () => {
    const audio = valid();
    audio.streams.push({ ...audio.streams[0]!, codec_type: 'audio' });
    expect(() => assertVideo(audio, 100)).toThrow();
    for (const patch of [{ pix_fmt: 'yuva420p' }, { codec_name: 'vp9' }, { width: 1080 }, { height: 1080 }]) {
      const data = valid(); Object.assign(data.streams[0]!, patch);
      expect(() => assertVideo(data, 100)).toThrow();
    }
    const long = valid(); long.format.duration = '25';
    expect(() => assertVideo(long, 100)).toThrow();
    expect(() => assertVideo(valid(), 1000001)).toThrow();
    expect(() => assertVideo(valid(), 0)).toThrow();
  });
});
