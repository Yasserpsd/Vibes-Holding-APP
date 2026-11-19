import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Country } from '@/api/auth';
import { CountryPicker } from '@/components/CountryPicker';
import { FormField } from '@/components/FormField';
import { getLang, t } from '@/i18n';
import { emailFix, phoneCountryFix } from '@/lib/fixes';
import { cleanEmail, isEmail, localPhoneDigits, phoneIssue } from '@/lib/validation';
import { themedStyles } from '@/theme/styles';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * M126: the sign-in identifier — a phone number from any country or an e-mail, picked with a
 * two-pill switch. The phone pill is first (the easy path): country dial code beside the digits,
 * typed on a numeric keyboard, with the leading zero stripped as the member types. Shared by the
 * login and the password-reset screens.
 */
export type IdentifierMode = 'phone' | 'email';

export type Identifier = { mode: IdentifierMode; country: string; value: string };

export const EMPTY_IDENTIFIER: Identifier = { mode: 'phone', country: 'sa', value: '' };

/** The request body fields for this identifier: the number plus its country, or the cleaned e-mail address. */
export function identifierPayload(identifier: Identifier): { login: string; country?: string } {
  if (identifier.mode === 'phone') return { login: identifier.value.trim(), country: identifier.country };
  // The address goes as the club stores it: no invisible marks, no trailing dot, lower case (lib/validation).
  return { login: cleanEmail(identifier.value) };
}

export function identifierValid(identifier: Identifier): boolean {
  if (identifier.mode === 'phone') return identifier.value.replace(/\D+/g, '').length >= 5;
  return isEmail(identifier.value);
}

/**
 * M128 (owner): a typed phone that is too short, too long or starts wrong gets one clear
 * message — «تأكد من رقم الجوال» with the country's X-format. Null when the number is fine.
 */
export function identifierPhoneProblem(identifier: Identifier, countries: Country[] | undefined): string | null {
  if (identifier.mode !== 'phone') return null;
  const country = countries?.find((item) => item.code === identifier.country);
  if (phoneIssue(identifier.value, country) === null) return null;
  const format = country?.example?.replace(/^0+/, '') || t('auth.login.phonePlaceholder');
  return t('auth.phone.check', { format });
}

type Props = {
  value: Identifier;
  onChange: (value: Identifier) => void;
  countries: Country[] | undefined;
  editable?: boolean;
};

export function LoginIdentifierField({ value, onChange, countries, editable = true }: Props) {
  // Keep each mode's draft so flipping the switch never loses what was typed.
  const [drafts, setDrafts] = useState<Record<IdentifierMode, string>>({ phone: '', email: '' });
  const country = countries?.find((item) => item.code === value.country);
  const placeholder = useMemo(() => (country?.example ? country.example.replace(/^0+/, '') : t('auth.login.phonePlaceholder')), [country]);
  // Live check: flag the number the moment it starts wrong or runs long; a short one waits for submit.
  const phoneBad = value.mode === 'phone' && phoneIssue(value.value, country) === 'bad';
  // M255: the same one-tap corrections as the sign-up form — the country a number was typed for, the address meant.
  const phoneLand = phoneBad && editable && countries ? phoneCountryFix(value.value, value.country, countries) : null;
  const emailMeant = value.mode === 'email' && editable ? emailFix(value.value) : null;

  const switchMode = (mode: IdentifierMode) => {
    if (mode === value.mode || !editable) return;
    setDrafts((current) => ({ ...current, [value.mode]: value.value }));
    onChange({ ...value, mode, value: drafts[mode] });
  };

  return (
    <View style={styles.block}>
      <View style={styles.switch} accessibilityRole="tablist">
        {(['phone', 'email'] as const).map((mode) => {
          const selected = mode === value.mode;
          return (
            <Pressable
              key={mode}
              style={[styles.pill, selected && styles.pillSelected]}
              onPress={() => switchMode(mode)}
              hitSlop={{ top: 4, bottom: 4 }}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.pillText, selected && styles.pillTextSelected]} numberOfLines={1}>
                {t(`auth.login.method.${mode}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {value.mode === 'phone' ? (
        <View style={styles.phoneRow}>
          {countries?.length ? (
            <View style={styles.dialBox}>
              <CountryPicker compact disabled={!editable} countries={countries} selected={value.country} onSelect={(code) => onChange({ ...value, country: code })} />
            </View>
          ) : null}
          <View style={styles.phoneField}>
            <FormField
              label={t('auth.login.method.phone')}
              latin
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              autoCorrect={false}
              editable={editable}
              value={value.value}
              onChangeText={(text) => {
                // A saved login or a pasted address can land in this field: an «@» or a letter means an e-mail, so the
                // e-mail tab takes the text whole instead of this field stripping it down to its digits.
                if (/[@A-Za-z]/.test(text)) {
                  setDrafts((current) => ({ ...current, phone: value.value }));
                  onChange({ ...value, mode: 'email', value: text });
                  return;
                }
                onChange({ ...value, value: localPhoneDigits(text, country) });
              }}
              placeholder={placeholder}
              hint={t('auth.login.phoneHint')}
              error={phoneBad ? t('auth.phone.check', { format: placeholder }) : undefined}
              fix={
                phoneLand
                  ? {
                      label: t('form.fix.country', { country: (getLang() === 'en' && phoneLand.country.nameEn) || phoneLand.country.name }),
                      icon: 'earth-outline',
                      onPress: () => onChange({ ...value, country: phoneLand.country.code, value: phoneLand.phone }),
                    }
                  : null
              }
            />
          </View>
        </View>
      ) : (
        <FormField
          label={t('auth.login.method.email')}
          latin
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          autoComplete="email"
          editable={editable}
          value={value.value}
          onChangeText={(text) => onChange({ ...value, value: text })}
          // Leaving the field shows the address as it will be sent; never while typing.
          onBlur={() => {
            const cleaned = cleanEmail(value.value);
            if (cleaned !== value.value) onChange({ ...value, value: cleaned });
          }}
          placeholder={t('auth.login.emailPlaceholder')}
          warning={emailMeant ? t('form.fix.emailMeant') : null}
          fix={emailMeant ? { label: t('form.fix.use', { value: emailMeant }), onPress: () => onChange({ ...value, value: emailMeant }) } : null}
        />
      )}
    </View>
  );
}

const styles = themedStyles(() => ({
  block: { gap: spacing.sm },
  switch: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pill: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radii.pill },
  pillSelected: { backgroundColor: colors.goldSoft, borderWidth: 1, borderColor: colors.borderGold },
  pillText: { ...typography.caption, color: colors.textSecondary },
  pillTextSelected: { color: colors.goldLightText },
  phoneRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  // Skips the field's label line (caption lineHeight 20 + gap xs) so the dial box tops the input.
  dialBox: { marginTop: 24 },
  phoneField: { flex: 1 },
}));
