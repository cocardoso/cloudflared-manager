import { ERROR_CODES } from '@tm/shared';
import { describe, expect, it } from 'vitest';
import en from './en.json';
import i18n, { setLanguage } from './index';
import pt from './pt-BR.json';
import de from './de.json';
import es from './es.json';
import fr from './fr.json';
import it_ from './it.json';

const flatten = (o: object, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? flatten(v, `${p}${k}.`) : [`${p}${k}`]));

describe('i18n', () => {
  it.each([['pt-BR', pt], ['es', es], ['fr', fr], ['it', it_], ['de', de]])('%s has the same keys as en', (_, bundle) => {
    expect(flatten(bundle).sort()).toEqual(flatten(en).sort());
  });
  it.each([['es', es], ['fr', fr], ['it', it_], ['de', de]])('%s keeps every {{placeholder}} of en', (_, bundle) => {
    const values = (o: object, p = ''): [string, string][] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? values(v, `${p}${k}.`) : [[`${p}${k}`, String(v)]]));
    const other = Object.fromEntries(values(bundle));
    for (const [k, v] of values(en)) {
      const ph = (x: string) => (x.match(/{{\w+}}/g) ?? []).sort();
      expect([k, ph(other[k] ?? '')]).toEqual([k, ph(v)]);
    }
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
  it.each([['es-MX', 'es'], ['fr-CA', 'fr'], ['it-CH', 'it'], ['de-AT', 'de'], ['nl-NL', 'en']])('maps %s to %s', async (from, to) => {
    await setLanguage(from);
    expect(i18n.resolvedLanguage).toBe(to);
    await i18n.changeLanguage('en');
  });
  it('maps any Portuguese locale to pt-BR', async () => {
    await setLanguage('pt-PT');
    expect(i18n.resolvedLanguage).toBe('pt-BR');
    await i18n.changeLanguage('en');
  });
});
