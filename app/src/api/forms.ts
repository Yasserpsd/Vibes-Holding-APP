import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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

/** M193: sends one picked file for a form's file field and answers the link the form submits. */
export async function uploadFormFile(formKey: string, file: { uri: string; name: string; size: number; mimeType: string }): Promise<string> {
  const ticket = await apiRequest<FormUpload>('POST', `/api/forms/${encodeURIComponent(formKey)}/upload`, {
    body: { filename: file.name, contentType: file.mimeType, size: file.size },
  });
  const { upload } = ticket;
  const result =
    upload.method === 'POST'
      ? await FileSystem.uploadAsync(upload.url, file.uri, {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'file',
          mimeType: file.mimeType,
          parameters: upload.fields,
        })
      : await FileSystem.uploadAsync(upload.url, file.uri, {
          httpMethod: 'PUT',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: upload.headers,
        });
  if (result.status < 200 || result.status >= 300) throw new Error(`upload failed: ${result.status}`);
  return ticket.url;
}
