import type { UploadConfig, UploadLimits } from './api';

/** The contract's defaults, used until the server answers with its real limits. */
export const DEFAULT_UPLOAD_CONFIG: UploadConfig = {
  images: { types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], maxBytes: 10 * 1024 * 1024 },
  videos: { types: ['video/mp4', 'video/quicktime', 'video/webm'], maxBytes: 200 * 1024 * 1024 },
  durable: true,
};

const BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};
const LABELS: Record<string, string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
  'video/mp4': 'MP4',
  'video/quicktime': 'MOV',
  'video/webm': 'WebM',
};

export const megabytes = (bytes: number) => Math.max(1, Math.round(bytes / (1024 * 1024)));
/** Joined with «أو», not commas: Arabic words between the Latin names keep them in reading order under RTL. */
export const typeNames = (types: string[]) => types.map((type) => LABELS[type] ?? type).join(' أو ');

/** Some phones hand a file over with an empty type: fall back to its extension. */
export function typedFile(file: File): File {
  if (file.type) return file;
  const type = BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''];
  return type ? new File([file], file.name, { type, lastModified: file.lastModified }) : file;
}

/** The same checks the server runs, done first so a 200 MB mistake fails before it travels. Answers the Arabic problem, or null. */
export function fileProblem(file: File, limits: UploadLimits): string | null {
  if (!limits.types.includes(file.type)) return `«${file.name}»: نوع الملف غير مدعوم. الأنواع المسموحة: ${typeNames(limits.types)}.`;
  if (file.size > limits.maxBytes) return `«${file.name}»: حجم الملف أكبر من الحد المسموح وهو ${megabytes(limits.maxBytes)} ميجابايت.`;
  return null;
}

const POSTER_MAX_SIDE = 1280;
const POSTER_TIMEOUT_MS = 10_000;

/**
 * Grabs a poster frame from a picked video without touching the page: an off-DOM <video> on an object URL,
 * a seek, a canvas, a JPEG. Never rejects: any failure (a codec the browser cannot decode, a stalled load,
 * a tainted canvas) answers null and the post simply goes without a poster.
 */
export function capturePoster(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const source = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;
    const finish = (frame: Blob | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.onloadedmetadata = video.onseeked = video.onerror = null;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(source);
      resolve(frame);
    };
    const timer = window.setTimeout(() => finish(null), POSTER_TIMEOUT_MS);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      // About one second in, or 10% of a clip shorter than ten seconds. Never exactly 0: a seek to the current time fires no `seeked`.
      const target = Number.isFinite(video.duration) ? Math.min(1, video.duration * 0.1) : 0;
      video.currentTime = Math.max(target, 0.01);
    };
    video.onseeked = () => {
      const scale = Math.min(1, POSTER_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const context = canvas.getContext('2d');
      if (!context || !canvas.width || !canvas.height) {
        finish(null);
        return;
      }
      try {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(finish, 'image/jpeg', 0.8);
      } catch {
        finish(null);
      }
    };
    video.src = source;
  });
}
