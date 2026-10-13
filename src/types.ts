export type Language = 'en' | 'fa' | 'ps';
export type Data = Record<string, any>;
export interface User {
  id: number;
  name: string;
  username: string;
  role: string;
  revision: number;
  permissions: Record<string, string | boolean>;
}
export interface Page<T = Data> {
  items: T[];
  next_cursor: string | null;
  previous_cursor: string | null;
  limit: number;
}
export interface Pharmacy {
  name: string;
  address: string;
  phone: string;
  logo: string;
  footer: string;
  prefix: string;
  language: Language;
  calendar: 'persian' | 'gregory';
  timezone: string;
  expiry_days: number;
  paper: 'a4' | '80mm';
  columns: string[];
  backup_retention: number;
  templates?: Partial<Record<'a4' | '80mm', { columns: string[]; footer: string }>>;
}
export interface Product extends Data {
  id: number;
  name: string;
  generic: string;
  strength: string;
  base_unit: string;
  on_hand: number;
  reorder_level: number;
  units: Unit[];
}
export interface Unit {
  id: number;
  name: string;
  multiplier: number;
  price_minor: number;
}
export interface Discount {
  kind: 'amount' | 'percent';
  value: string;
}
export interface BillLine {
  key: string;
  product_id: number;
  unit_id: number;
  name: string;
  units: Unit[];
  quantity: number;
  price: string;
  discount: Discount;
  batch_number: string;
  expiry: string;
}
export interface Bill {
  kind: 'sale' | 'purchase';
  party_id: number | null;
  party_name: string;
  party_balance_minor?: number;
  date: string;
  lines: BillLine[];
  discount: Discount;
  paid: string;
  method: string;
  note: string;
}
export type Action =
  | 'bootstrap'
  | 'setup'
  | 'login'
  | 'logout'
  | 'me'
  | 'list'
  | 'detail'
  | 'dashboard'
  | 'settings'
  | 'presets'
  | 'backup_status'
  | 'backup'
  | 'inspect_backup'
  | 'restore'
  | 'export'
  | 'cancel_export'
  | 'save_party'
  | 'save_product'
  | 'save_category'
  | 'save_user'
  | 'save_draft'
  | 'delete_draft'
  | 'post_bill'
  | 'post_payment'
  | 'post_return'
  | 'post_expense'
  | 'adjust_stock'
  | 'save_settings';
