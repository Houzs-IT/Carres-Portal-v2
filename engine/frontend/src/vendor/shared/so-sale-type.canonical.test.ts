// Carres: the Sale type rule (owner 12 Nov 2026) lives twice, here and in the backend. This keeps them one.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { DEFAULT_SO_SALE_TYPE, parseSoSaleType, soSaleTypeLabel, SO_SALE_TYPE_OPTIONS } from './so-sale-type';

describe('so-sale-type', () => {
  test('is byte-identical to the backend copy', () => {
    const norm = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n');
    expect(norm('src/vendor/shared/so-sale-type.ts')).toBe(norm('../backend/src/scm/shared/so-sale-type.ts'));
  });

  test('Outright is the default, Subscription the other choice', () => {
    expect(DEFAULT_SO_SALE_TYPE).toBe('outright');
    expect(SO_SALE_TYPE_OPTIONS.map((o) => o.label)).toEqual(['Outright', 'Subscription']);
  });

  test('reads a label or a stored value, and nothing else', () => {
    expect(parseSoSaleType('Subscription')).toBe('subscription');
    expect(parseSoSaleType(' outright ')).toBe('outright');
    expect(parseSoSaleType('rental')).toBeNull();
    expect(parseSoSaleType(null)).toBeNull();
  });

  test('an unknown value shows as Outright, as the column defaults', () => {
    expect(soSaleTypeLabel('subscription')).toBe('Subscription');
    expect(soSaleTypeLabel(undefined)).toBe('Outright');
  });
});
