import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Save, Upload, ImagePlus, Building2, SlidersHorizontal, ReceiptText } from 'lucide-react';
import { api, requestId } from '../api';
import { useApp } from '../context';
import { languages } from '../i18n';
import { today } from '../format';
import { PageHeader, Field, Input, Spinner, ErrorState } from '../components/ui';
import { InvoicePaper } from './Print';
import { useDraft } from '../hooks/useDraft';
import type { Data, Pharmacy } from '../types';
export default function SettingsPage() {
  const { settings } = useApp();
  return settings ? <SettingsBody initial={settings} /> : <Spinner />;
}
export function SettingsBody({ initial, existing }: { initial: Pharmacy; existing?: Data }) {
  const { t, can, notify, setLanguage, setCalendar } = useApp();
  const client = useQueryClient();
  const [form, setForm] = useState<Pharmacy>(existing?.payload || initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const draft = useDraft('settings', 'Settings', form, existing, can('settings', true));
  const set = (key: keyof Pharmacy, value: unknown) => setForm((f) => ({ ...f, [key]: value }));
  function selectPaper(paper: Pharmacy['paper']) {
    setForm((f) => ({
      ...f,
      ...(f.templates?.[paper] || {}),
      paper,
      templates: { ...f.templates, [f.paper]: { columns: f.columns, footer: f.footer } },
    }));
  }
  const document = {
    kind: 'sale',
    number: `${form.prefix}-0000001`,
    date: today(),
    party_name: 'Walk-in customer',
    subtotal_minor: 165000,
    discount_minor: 5000,
    total_minor: 160000,
    paid_minor: 100000,
    outstanding_minor: 60000,
    pharmacy_snapshot: form,
    lines: [
      {
        id: 1,
        name: 'Paracetamol 500 mg',
        unit: 'strip',
        quantity: 5,
        price_minor: 12000,
        discount_minor: 0,
        total_minor: 60000,
      },
      {
        id: 2,
        name: 'Amoxicillin 250 mg',
        unit: 'box',
        quantity: 3,
        price_minor: 35000,
        discount_minor: 5000,
        total_minor: 100000,
      },
    ],
  };
  async function save() {
    setBusy(true);
    setError('');
    try {
      await draft.stop();
      await api('save_settings', {
        settings: {
          ...form,
          templates: {
            ...form.templates,
            [form.paper]: { columns: form.columns, footer: form.footer },
          },
        },
        request_id: requestId(),
        draft_id: draft.id,
      });
      setLanguage(form.language);
      setCalendar(form.calendar);
      await client.invalidateQueries({ queryKey: ['settings'] });
      draft.commit();
      notify('Settings saved');
    } catch (e) {
      draft.resume();
      setError((e as Error).message);
    } finally {
      setBusy(false);
      draft.resume();
    }
  }
  function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > 2_000_000 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify('Use a PNG, JPEG, or WebP logo smaller than 2 MB', true);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set('logo', String(reader.result));
    reader.readAsDataURL(file);
  }
  if (!can('settings')) return <ErrorState error={new Error(t('Access denied'))} />;
  return (
    <div className="enter">
      <PageHeader
        title="Settings"
        actions={
          can('settings', true) ? (
            <button className="button primary" onClick={() => void save()} disabled={busy}>
              {busy ? <Spinner /> : <Save size={16} />} {t('Save settings')}
            </button>
          ) : null
        }
      />
      <div className="muted small">{t(draft.status)}</div>
      {error || draft.error ? <div className="inline-error">{t(error || draft.error)}</div> : null}
      <div className="settings-layout">
        <div className="settings-forms">
          <section className="panel settings-section">
            <h2>
              <Building2 size={18} />
              {t('Pharmacy profile')}
            </h2>
            <div className="logo-upload">
              <div className="logo-preview">
                {form.logo ? <img src={form.logo} alt={form.name} /> : <ImagePlus size={26} />}
              </div>
              <div>
                <label className="button secondary">
                  <Upload size={15} />
                  {t('Upload logo')}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(e) => upload(e.target.files?.[0])}
                  />
                </label>
                {form.logo ? (
                  <button className="text-button danger-text" onClick={() => set('logo', '')}>
                    {t('Remove logo')}
                  </button>
                ) : (
                  <small>PNG, JPG, WebP · 2 MB</small>
                )}
              </div>
            </div>
            <Field label="Pharmacy name" required>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <div className="form-grid">
              <Field label="Phone">
                <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <Field label="Invoice prefix">
                <Input
                  value={form.prefix}
                  maxLength={12}
                  onChange={(e) => set('prefix', e.target.value)}
                />
              </Field>
            </div>
            <Field label="Address">
              <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
            </Field>
          </section>
          <section className="panel settings-section">
            <h2>
              <SlidersHorizontal size={18} />
              {t('Preferences')}
            </h2>
            <div className="form-grid">
              <Field label="Language">
                <select
                  className="input"
                  value={form.language}
                  onChange={(e) => set('language', e.target.value)}
                >
                  {languages.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Calendar">
                <select
                  className="input"
                  value={form.calendar}
                  onChange={(e) => set('calendar', e.target.value)}
                >
                  <option value="persian">{t('Solar Hijri')}</option>
                  <option value="gregory">{t('Gregorian')}</option>
                </select>
              </Field>
              <Field label="Expiry warning (days)">
                <Input
                  type="number"
                  min="1"
                  max="730"
                  value={form.expiry_days}
                  onChange={(e) => set('expiry_days', Number(e.target.value))}
                />
              </Field>
            </div>
          </section>
          <section className="panel settings-section">
            <h2>
              <ReceiptText size={18} />
              {t('Invoice template')}
            </h2>
            <Field label="Paper size">
              <div className="paper-options">
                {[
                  ['a4', 'A4 invoice'],
                  ['80mm', '80 mm receipt'],
                ].map(([v, label]) => (
                  <button
                    key={v}
                    className={form.paper === v ? 'selected' : ''}
                    onClick={() => selectPaper(v as Pharmacy['paper'])}
                  >
                    <span className={v === 'a4' ? 'paper-icon' : 'paper-icon narrow'} />
                    {t(label)}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Visible columns">
              <div className="checkbox-row">
                {['unit', 'quantity', 'price', 'discount'].map((key) => (
                  <label className="check-label" key={key}>
                    <input
                      type="checkbox"
                      checked={form.columns.includes(key)}
                      onChange={(e) =>
                        set(
                          'columns',
                          e.target.checked
                            ? [...form.columns, key]
                            : form.columns.filter((c) => c !== key),
                        )
                      }
                    />
                    {t(key[0].toUpperCase() + key.slice(1))}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Footer message">
              <textarea
                className="input"
                rows={3}
                value={form.footer}
                onChange={(e) => set('footer', e.target.value)}
              />
            </Field>
          </section>
        </div>
        <section className="panel template-preview">
          <div className="panel-header">
            <h2>{t('Print preview')}</h2>
            <span className="date-chip">{form.paper === 'a4' ? 'A4' : '80 mm'}</span>
          </div>
          <div className="template-stage">
            <InvoicePaper document={document} preview />
          </div>
        </section>
      </div>
    </div>
  );
}
