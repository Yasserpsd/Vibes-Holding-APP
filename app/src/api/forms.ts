import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiRequest } from './client';

// M16 registration forms — mirrors server/src/forms/routes.ts.
export type FormFieldType = 'text' | 'textarea' | 'select' | 'agree';
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
  access: 'everyone' | 'signedIn';
  once: boolean;
  open: boolean;
  closedText: string;
  submitLabel: string;
  successText: string;
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
