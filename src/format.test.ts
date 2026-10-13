import { describe, it, expect } from 'vitest';
import { minor, discount, fromDateParts, dateParts, dateLabel, fromMonthParts } from './format';
describe('invoice preview money', () => {
  it('parses decimal inputs without float multiplication', () => {
    expect(minor('12.03')).toBe(1203);
    expect(minor('0.1')).toBe(10);
    expect(minor('NaN')).toBe(0);
  });
  it('rounds percentage discounts to the nearest minor unit', () => {
    expect(discount(999, { kind: 'percent', value: '12.5' })).toBe(125);
    expect(discount(100, { kind: 'amount', value: '5' })).toBe(100);
  });
});
describe('calendar input', () => {
  it('resolves month-only expiry to the end of either calendar month', () => {
    expect(fromMonthParts('2024', '02', 'gregory')).toBe('2024-02-29');
    expect(dateParts(fromMonthParts('1405', '01', 'persian'), 'persian').day).toBe('31');
    expect(dateParts(fromMonthParts('1405', '07', 'persian'), 'persian').day).toBe('30');
  });
  it('uses Afghanistan month names', () => {
    expect(dateLabel('2026-10-13', 'en', 'persian')).toBe('21 Mizan 1405');
    expect(dateLabel('2026-10-13', 'fa', 'persian')).toContain('میزان');
  });
  it('round trips Solar Hijri and Gregorian dates', () => {
    for (const d of ['2026-03-21', '2024-02-29', '2026-10-13']) {
      const parts = dateParts(d, 'persian');
      expect(fromDateParts(parts.year, parts.month, parts.day, 'persian')).toBe(d);
    }
  });
  it('rejects impossible dates', () => {
    expect(fromDateParts('2026', '02', '30', 'gregory')).toBe('');
  });
  it('accepts Persian numerals', () => {
    expect(fromDateParts('۲۰۲۶', '۱۰', '۱۳', 'gregory')).toBe('2026-10-13');
  });
});
