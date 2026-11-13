// Browser media helpers: image compression before upload, and the voice-note recorder.

export const MAX_IMAGE_EDGE = 1600;

/** Fits (w, h) inside a max edge, keeping the aspect ratio. Pure; tested. */
export function fitWithin(w: number, h: number, max = MAX_IMAGE_EDGE): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  const s = max / Math.max(w, h);
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

/**
 * Downscales a photo to <= 1600 px on its longest edge and re-encodes it as JPEG (orientation is
 * applied by createImageBitmap). GIFs and small images are sent as they are.
 */
export async function compressImage(file: File, max = MAX_IMAGE_EDGE, quality = 0.82): Promise<File> {
  if (file.type === 'image/gif') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // unknown format (HEIC on some browsers): let the SDK try
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
  if (width === bitmap.width && height === bitmap.height && file.size < 1_000_000) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', quality));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
}

/** The best recording format this browser supports (Chrome/Firefox: Opus in WebM; Safari: AAC in MP4). */
export function pickAudioMime(
  isSupported: (t: string) => boolean = t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t),
): string | null {
  for (const t of ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']) if (isSupported(t)) return t;
  return null;
}

export const MAX_VOICE_S = 60;

export interface Recording {
  file: File;
  durationS: number;
}

/** Starts a recording; call stop() to get the file, cancel() to throw it away. */
export async function startRecording(): Promise<{ stop: () => Promise<Recording | null>; cancel: () => void; startedAt: number }> {
  const mime = pickAudioMime();
  if (!mime || !navigator.mediaDevices?.getUserMedia) throw new Error('Voice notes are not supported in this browser');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = e => e.data.size > 0 && chunks.push(e.data);
  const startedAt = performance.now();
  rec.start(250);
  const release = () => stream.getTracks().forEach(t => t.stop());
  let done = false;
  return {
    startedAt,
    cancel: () => {
      if (done) return;
      done = true;
      rec.onstop = release;
      rec.stop();
    },
    stop: () =>
      new Promise(resolve => {
        if (done) return resolve(null);
        done = true;
        rec.onstop = () => {
          release();
          const durationS = (performance.now() - startedAt) / 1000;
          if (durationS < 0.6 || chunks.length === 0) return resolve(null);
          const type = mime.split(';')[0]!;
          const ext = type === 'audio/mp4' ? 'm4a' : type === 'audio/ogg' ? 'ogg' : 'webm';
          resolve({ file: new File(chunks, `voice-${Date.now()}.${ext}`, { type }), durationS: Math.min(MAX_VOICE_S, durationS) });
        };
        rec.stop();
      }),
  };
}
