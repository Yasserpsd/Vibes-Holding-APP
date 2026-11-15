import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requireOptionalNativeModule } from 'expo';
import * as FileSystem from 'expo-file-system/legacy';

import { apiGet, apiRequest } from './client';

// M16 registration forms — mirrors server/src/forms/routes.ts.
/** M193: `file` = one attachment the app uploads; its private link is the answer. */
export type FormFieldType = 'text' | 'textarea' | 'select' | 'agree' | 'file';
export type FormField = {
  key: string;
  label: string;
  type: FormFieldType;
  options?: string[];
  placeholder?: string;
  required: boolean;
  url?: string | null;
  latin?: boolean;
  prefill?: 'firstName' | 'lastName' | 'phone' | 'email';
};
export type FormDef = {
  key: string;
  title: string;
  intro: string;
  /** M73: 'member' = subscribed members only (the server refuses everyone else). */
  access: 'everyone' | 'signedIn' | 'member';
  once: boolean;
  open: boolean;
  closedText: string;
  submitLabel: string;
  successText: string;
  /** Owner (2026-10-25): the post-submission membership condition for non-members; an older server sends none. */
  memberNudge?: string;
  /** M170 (owner, 2026-10-31): the condition a signed-in non-member reads BEFORE the form; an older server sends none. */
  nonMemberNotice?: string;
  fields: FormField[];
};
export type MyFormSubmission = { id: string; formKey: string; createdAt: string };

/** The value an `agree` field sends when ticked (the server checks for exactly this). */
export const AGREED = '1';

export function useFormDef(key: string | undefined) {
  return useQuery({
    queryKey: ['form', key],
    queryFn: () => apiGet<{ form: FormDef }>(`/api/forms/${encodeURIComponent(key ?? '')}`),
    enabled: Boolean(key),
    staleTime: 60_000,
  });
}

export function useMyFormSubmissions(enabled: boolean) {
  return useQuery({
    queryKey: ['forms', 'mine'],
    queryFn: () => apiGet<{ submissions: MyFormSubmission[] }>('/api/forms/mine'),
    enabled,
  });
}

export function useSubmitForm(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (answers: Record<string, string>) => apiRequest<{ submission: MyFormSubmission }>('POST', `/api/forms/${encodeURIComponent(key)}`, { body: { answers } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['forms', 'mine'] }),
  });
}

/** The ticket the server hands out (server/src/forms/files.ts): a presigned bucket POST, or the disk store's PUT in development. */
type FormUpload = {
  url: string;
  upload: { method: 'POST'; url: string; fields: Record<string, string> } | { method: 'PUT'; url: string; headers: Record<string, string> };
};

/** M241: the member stopped the upload himself — the caller shows nothing for it. */
export class UploadCancelledError extends Error {
  constructor() {
    super('upload cancelled');
    this.name = 'UploadCancelledError';
  }
}

/** M241: what a caller may hand an upload — a progress listener (0 to 1) and a signal that cancels it. */
export type UploadFormFileOptions = { onProgress?: (fraction: number) => void; signal?: AbortSignal };

/**
 * M241: the upload TASK (progress events + cancel) needs two native methods of the file-system module.
 * The same bundle runs on the 1.2.0 to 1.3.3 binaries, so a binary without them keeps the plain upload.
 */
const nativeFileSystem = requireOptionalNativeModule<{ uploadTaskStartAsync?: unknown; networkTaskCancelAsync?: unknown }>('ExponentFileSystem');
const hasUploadTask = typeof FileSystem.createUploadTask === 'function' && Boolean(nativeFileSystem?.uploadTaskStartAsync) && Boolean(nativeFileSystem?.networkTaskCancelAsync);

/** The task could not even start on this binary (a missing native method or listener): nothing was sent yet. */
function taskUnavailable(cause: unknown): boolean {
  if (cause instanceof TypeError) return true;
  return typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'ERR_UNAVAILABLE';
}

/** One file to one address: through the upload task when the binary has it, the plain upload otherwise. */
async function sendFile(url: string, fileUri: string, uploadOptions: FileSystem.FileSystemUploadOptions, { onProgress, signal }: UploadFormFileOptions): Promise<FileSystem.FileSystemUploadResult> {
  if (hasUploadTask) {
    const task = FileSystem.createUploadTask(url, fileUri, uploadOptions, (progress) => {
      if (onProgress && progress.totalBytesExpectedToSend > 0) onProgress(Math.min(1, progress.totalBytesSent / progress.totalBytesExpectedToSend));
    });
    const stop = () => void task.cancelAsync().catch(() => undefined);
    signal?.addEventListener('abort', stop);
    try {
      const result = await task.uploadAsync();
      // A cancelled task answers nothing.
      if (signal?.aborted) throw new UploadCancelledError();
      if (!result) throw new Error('upload failed: no result');
      return result;
    } catch (cause) {
      if (signal?.aborted) throw new UploadCancelledError();
      if (!taskUnavailable(cause)) throw cause;
      // Falls through to the plain upload below.
    } finally {
      signal?.removeEventListener('abort', stop);
    }
  }
  const result = await FileSystem.uploadAsync(url, fileUri, uploadOptions);
  // The plain upload cannot be stopped half-way; a cancel during it still discards the result.
  if (signal?.aborted) throw new UploadCancelledError();
  return result;
}

/**
 * M193: sends one picked file for a form's file field and answers the link the form submits.
 * M241: reports its progress and can be cancelled (rejects with UploadCancelledError).
 */
export async function uploadFormFile(formKey: string, file: { uri: string; name: string; size: number; mimeType: string }, options: UploadFormFileOptions = {}): Promise<string> {
  if (options.signal?.aborted) throw new UploadCancelledError();
  const ticket = await apiRequest<FormUpload>('POST', `/api/forms/${encodeURIComponent(formKey)}/upload`, {
    body: { filename: file.name, contentType: file.mimeType, size: file.size },
  });
  if (options.signal?.aborted) throw new UploadCancelledError();
  const { upload } = ticket;
  const uploadOptions: FileSystem.FileSystemUploadOptions =
    upload.method === 'POST'
      ? {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'file',
          mimeType: file.mimeType,
          parameters: upload.fields,
        }
      : {
          httpMethod: 'PUT',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: upload.headers,
        };
  const result = await sendFile(upload.url, file.uri, uploadOptions, options);
  if (result.status < 200 || result.status >= 300) throw new Error(`upload failed: ${result.status}`);
  return ticket.url;
}
