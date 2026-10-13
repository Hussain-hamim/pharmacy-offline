import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer, CheckCircle2 } from 'lucide-react';
import { api, printPage } from '../api';
import { useApp } from '../context';
import { translate } from '../i18n';
import { money, dateLabel } from '../format';
import { Modal, Spinner, ErrorState } from '../components/ui';
import type { Data, Language } from '../types';
export function InvoicePaper({
  document: original,
  preview = false,
}: {
  document: Data;
  preview?: boolean;
}) {
  const s = original.pharmacy_snapshot || {};
  const doc = { ...original, ...s.document };
  const language: Language = s.language || 'en';
  const t = (v: string) => translate(v, language);
  const columns: string[] = s.columns || ['unit', 'quantity', 'price', 'discount'];
  return (
    <article
      className={`invoice-paper ${s.paper === '80mm' ? 'receipt-paper' : ''}`}
      dir={language === 'en' ? 'ltr' : 'rtl'}
      lang={language}
    >
      <div className="invoice-brand">
        {s.logo ? <img src={s.logo} alt={s.name} /> : <span className="invoice-cross">+</span>}
        <h1>{s.name || 'Radefy Pharmacy'}</h1>
        {s.address ? <p>{s.address}</p> : null}
        {s.phone ? <p dir="ltr">{s.phone}</p> : null}
      </div>
      <div className="invoice-heading">
        <h2>
          {t(
            doc.kind === 'purchase'
              ? 'Supplier bill'
              : doc.kind === 'customer_return'
                ? 'Customer return'
                : doc.kind === 'supplier_return'
                  ? 'Supplier return'
                  : 'Invoice',
          )}
        </h2>
        <strong dir="ltr">{doc.number || 'INV-0000001'}</strong>
      </div>
      <div className="invoice-meta">
        <div>
          <span>{t('Date')}</span>
          <b>{dateLabel(doc.date, language, s.calendar || 'persian')}</b>
        </div>
        <div>
          <span>{t(doc.kind === 'purchase' ? 'Supplier' : 'Customer')}</span>
          <b>{t(doc.party_name || 'Walk-in customer')}</b>
        </div>
        {doc.party_phone ? (
          <div>
            <span>{t('Phone')}</span>
            <b dir="ltr">{doc.party_phone}</b>
          </div>
        ) : null}
      </div>
      <table className="invoice-table">
        <thead>
          <tr>
            <th>#</th>
            <th>{t('Product')}</th>
            {columns.includes('unit') ? <th>{t('Unit')}</th> : null}
            {columns.includes('quantity') ? <th>{t('Quantity')}</th> : null}
            {columns.includes('price') ? <th>{t('Price')}</th> : null}
            {columns.includes('discount') ? <th>{t('Discount')}</th> : null}
            <th>{t('Total')}</th>
          </tr>
        </thead>
        <tbody>
          {(doc.lines || []).map((line: Data, index: number) => (
            <tr key={line.id || index}>
              <td>{index + 1}</td>
              <td>{line.name}</td>
              {columns.includes('unit') ? <td>{line.unit}</td> : null}
              {columns.includes('quantity') ? <td>{line.quantity}</td> : null}
              {columns.includes('price') ? <td>{money(line.price_minor, language)}</td> : null}
              {columns.includes('discount') ? (
                <td>{money(line.discount_minor, language)}</td>
              ) : null}
              <td>{money(line.total_minor, language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="invoice-totals">
        <div>
          <span>{t('Subtotal')}</span>
          <b>{money(doc.subtotal_minor, language)}</b>
        </div>
        <div>
          <span>{t('Discount')}</span>
          <b>{money(doc.discount_minor, language)}</b>
        </div>
        <div className="invoice-grand">
          <span>
            {t('Total')} ({t('AFN')})
          </span>
          <b>{money(doc.total_minor, language)}</b>
        </div>
        <div>
          <span>{t('Amount paid')}</span>
          <b>{money(doc.paid_minor, language)}</b>
        </div>
        {doc.credit_minor > 0 ? (
          <div>
            <span>{t('Account credit')}</span>
            <b>{money(doc.credit_minor, language)}</b>
          </div>
        ) : null}
        <div>
          <span>{t('Amount due')}</span>
          <b>{money(doc.outstanding_minor, language)}</b>
        </div>
      </div>
      {doc.note ? <p className="invoice-note">{doc.note}</p> : null}
      <footer className="invoice-footer">
        <p>{s.footer}</p>
        <small>{doc.user_name ? `${t('User')}: ${doc.user_name}` : ''}</small>
      </footer>
      {preview ? <div className="preview-watermark">{t('Preview')}</div> : null}
    </article>
  );
}
export function usePrint() {
  const [doc, setDoc] = useState<Data | null>(null);
  const { notify } = useApp();
  useEffect(() => {
    if (!doc) return;
    let live = true;
    const after = () => setDoc(null);
    window.addEventListener('afterprint', after);
    void document.fonts.ready.then(() =>
      requestAnimationFrame(() => {
        if (live) void printPage().catch((error: Error) => notify(error.message, true));
      }),
    );
    return () => {
      live = false;
      window.removeEventListener('afterprint', after);
    };
  }, [doc]);
  return {
    print: (next: Data) => setDoc({ ...next }),
    host: doc
      ? createPortal(
          <div className={`print-host ${doc.pharmacy_snapshot?.paper === '80mm' ? 'thermal' : ''}`}>
            <style>{`@media print { @page { size: ${doc.pharmacy_snapshot?.paper === '80mm' ? '80mm auto' : 'A4'}; margin: ${doc.pharmacy_snapshot?.paper === '80mm' ? '3mm' : '12mm'}; } }`}</style>
            <InvoicePaper document={doc} />
          </div>,
          document.body,
        )
      : null,
  };
}
export function InvoiceModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { t, language, calendar } = useApp();
  const query = useQuery({
    queryKey: ['detail', 'document', id],
    queryFn: () => api('detail', { entity: 'document', id }),
  });
  const printer = usePrint();
  return (
    <>
      <Modal
        title={query.data?.number || 'Invoice'}
        wide
        onClose={onClose}
        footer={
          <>
            <button className="button secondary" onClick={onClose}>
              {t('Close')}
            </button>
            <button
              className="button primary"
              disabled={!query.data}
              onClick={() => printer.print(query.data!)}
            >
              <Printer size={16} />
              {t('Print')}
            </button>
          </>
        }
      >
        {query.isLoading ? (
          <Spinner />
        ) : query.error ? (
          <ErrorState error={query.error} />
        ) : (
          <>
            <div className="posted-info">
              <CheckCircle2 size={16} />
              {t('Invoice posted')}
              <span>{dateLabel(query.data?.date, language, calendar)}</span>
            </div>
            <div className="invoice-preview-stage">
              <InvoicePaper document={query.data!} />
            </div>
            {query.data?.lines.some((l: Data) => l.allocations?.length) ? (
              <details className="allocations">
                <summary>{t('Batch allocations')}</summary>
                {query.data.lines.map((l: Data) => (
                  <div key={l.id}>
                    <strong>{l.name}</strong>
                    {l.allocations?.map((a: Data, i: number) => (
                      <span key={i}>
                        {a.number} · {a.quantity} · {a.expiry}
                      </span>
                    ))}
                  </div>
                ))}
              </details>
            ) : null}
          </>
        )}
      </Modal>
      {printer.host}
    </>
  );
}
