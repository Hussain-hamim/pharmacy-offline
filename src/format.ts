import {
  CalendarDate,
  PersianCalendar,
  GregorianCalendar,
  toCalendar,
} from '@internationalized/date';
import type { Language, Discount } from './types';
const locales = { en: 'en-AF', fa: 'fa-AF', ps: 'ps-AF' };
export function money(minor: number | null | undefined, language: Language = 'en') {
  return new Intl.NumberFormat(locales[language], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((minor || 0) / 100);
}
export function amount(minor: number) {
  return (minor / 100).toFixed(2);
}
export function number(n: number, language: Language = 'en') {
  return new Intl.NumberFormat(locales[language]).format(n);
}
export function today() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kabul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}-${p.find((x) => x.type === 'day')!.value}`;
}
export function dateLabel(
  value: string | undefined,
  language: Language = 'en',
  calendar = 'persian',
) {
  if (!value) return '—';
  const date = new Date(
    value.length === 10
      ? value + 'T12:00:00Z'
      : /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)
        ? value.replace(' ', 'T') + 'Z'
        : value,
  );
  if (Number.isNaN(date.getTime())) return value;
  if (calendar === 'persian') {
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kabul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const gregorian = `${local.find((v) => v.type === 'year')!.value}-${local.find((v) => v.type === 'month')!.value}-${local.find((v) => v.type === 'day')!.value}`;
    const parts = dateParts(gregorian, 'persian');
    const names = {
      en: [
        'Hamal',
        'Sawr',
        'Jawza',
        'Saratan',
        'Asad',
        'Sunbula',
        'Mizan',
        'Aqrab',
        'Qaws',
        'Jadi',
        'Dalwa',
        'Hut',
      ],
      fa: [
        'حمل',
        'ثور',
        'جوزا',
        'سرطان',
        'اسد',
        'سنبله',
        'میزان',
        'عقرب',
        'قوس',
        'جدی',
        'دلو',
        'حوت',
      ],
      ps: [
        'وری',
        'غویی',
        'غبرګولی',
        'چنګاښ',
        'زمری',
        'وږی',
        'تله',
        'لړم',
        'لیندۍ',
        'مرغومی',
        'سلواغه',
        'کب',
      ],
    };
    const digits = new Intl.NumberFormat(locales[language], { useGrouping: false });
    return `${digits.format(Number(parts.day))} ${names[language][Number(parts.month) - 1]} ${digits.format(Number(parts.year))}`;
  }
  return new Intl.DateTimeFormat(`${locales[language]}-u-ca-${calendar}`, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kabul',
  }).format(date);
}
export function dateParts(value: string, calendar: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { year: '', month: '', day: '' };
  const [y, m, d] = value.split('-').map(Number);
  const date = toCalendar(
    new CalendarDate(y, m, d),
    calendar === 'persian' ? new PersianCalendar() : new GregorianCalendar(),
  );
  return {
    year: String(date.year),
    month: String(date.month).padStart(2, '0'),
    day: String(date.day).padStart(2, '0'),
  };
}
export function fromDateParts(year: string, month: string, day: string, calendar: string) {
  const [y, m, d] = [year, month, day].map((s) =>
    Number(
      s.replace(/[۰-۹٠-٩]/g, (c) =>
        String('۰۱۲۳۴۵۶۷۸۹'.includes(c) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) : '٠١٢٣٤٥٦٧٨٩'.indexOf(c)),
      ),
    ),
  );
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const cal = calendar === 'persian' ? new PersianCalendar() : new GregorianCalendar();
  const date = new CalendarDate(cal, y, m, d);
  if (date.year !== y || date.month !== m || date.day !== d) return '';
  return toCalendar(date, new GregorianCalendar()).toString();
}
export function fromMonthParts(year: string, month: string, calendar: string) {
  const first = fromDateParts(year, month, '1', calendar);
  if (!first) return '';
  const [y, m, d] = first.split('-').map(Number);
  const cal = calendar === 'persian' ? new PersianCalendar() : new GregorianCalendar();
  const date = toCalendar(new CalendarDate(y, m, d), cal);
  return toCalendar(
    date.set({ day: cal.getDaysInMonth(date) }),
    new GregorianCalendar(),
  ).toString();
}
export function minor(value: string) {
  if (!/^\d+(\.\d{0,2})?$/.test(value)) return 0;
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function discount(gross: number, d: Discount) {
  const v = minor(d.value || '0');
  return Math.min(
    gross,
    d.kind === 'percent'
      ? Number((BigInt(Math.round(gross)) * BigInt(Math.round(v)) + 5000n) / 10000n)
      : v,
  );
}
