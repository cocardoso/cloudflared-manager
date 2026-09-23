import { ERROR_CODES } from '@tm/shared';
import { describe, expect, it } from 'vitest';
import en from './en.json';
import i18n, { setLanguage } from './index';
import pt from './pt-BR.json';

const flatten = (o: object, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? flatten(v, `${p}${k}.`) : [`${p}${k}`]));

describe('i18n', () => {
  it('pt-BR and en have the same keys', () => {
    expect(flatten(pt).sort()).toEqual(flatten(en).sort());
  });
  it('every error code is translated', () => {
    for (const c of ERROR_CODES) expect(flatten(en)).toContain(`errors.${c}`);
  });
  it('switches language', async () => {
    await i18n.changeLanguage('pt-BR');
    expect(i18n.t('nav.dashboard')).toBe('Painel');
    await i18n.changeLanguage('en');
    expect(i18n.t('nav.dashboard')).toBe('Dashboard');
  });
  it('maps any Portuguese locale to pt-BR', async () => {
    await setLanguage('pt-PT');
    expect(i18n.resolvedLanguage).toBe('pt-BR');
    await i18n.changeLanguage('en');
  });
});
