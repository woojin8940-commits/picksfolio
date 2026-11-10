import writeXlsxFile from 'write-excel-file/browser';
import readXlsxFile from 'read-excel-file/browser';
import { ORDER_STATUS_LABEL, SHIPPING_COURIERS, type StoreOrder } from '../../services/affiliateStoreService';

/**
 * 브랜드 주문 엑셀 처리.
 *   내려받기: 주문 목록(받는 분 · 주소 · 송장 포함). 같은 파일에 택배사 · 송장번호를 채워 다시 올리면 일괄 발송된다.
 *   올리기: 첫 줄(머리글)에서 '주문번호' · '택배사' · '송장번호' 열을 찾는다. 송장번호가 빈 줄은 건너뛴다.
 */

const ORDER_ID_COL = '주문번호';
const COURIER_COL = '택배사';
const TRACKING_COL = '송장번호';

const fmt = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const COLUMNS: { title: string; width: number; value: (o: StoreOrder) => string | number }[] = [
  { title: ORDER_ID_COL, width: 26, value: o => o.id },
  { title: '주문상태', width: 12, value: o => ORDER_STATUS_LABEL[o.status] || o.status },
  { title: '주문일시', width: 17, value: o => fmt(o.paidAt || o.createdAt) },
  { title: '상품명', width: 30, value: o => o.productName || '' },
  { title: '옵션', width: 16, value: o => o.optionName || '' },
  { title: '수량', width: 6, value: o => Number(o.quantity) || 0 },
  { title: '결제금액', width: 11, value: o => Number(o.totalAmount) || 0 },
  { title: '받는 분', width: 10, value: o => o.recipientName || '' },
  { title: '받는 분 연락처', width: 15, value: o => o.recipientPhone || '' },
  { title: '우편번호', width: 8, value: o => o.postcode || '' },
  { title: '주소', width: 36, value: o => o.address1 || '' },
  { title: '상세주소', width: 20, value: o => o.address2 || '' },
  { title: '배송 메모', width: 20, value: o => o.deliveryMemo || '' },
  { title: '주문자', width: 10, value: o => o.buyerName || '' },
  { title: '주문자 연락처', width: 15, value: o => o.buyerPhone || '' },
  { title: '인플루언서', width: 14, value: o => o.influencerUsername ? `@${o.influencerUsername}` : '' },
  { title: COURIER_COL, width: 12, value: o => o.trackingCompany || '' },
  { title: TRACKING_COL, width: 18, value: o => o.trackingNumber || '' },
];

export async function downloadOrdersExcel(orders: StoreOrder[], fileName: string) {
  const header = COLUMNS.map(c => ({ value: c.title, fontWeight: 'bold' as const, backgroundColor: '#EEF2F7' }));
  const rows = orders.map(o => COLUMNS.map(c => {
    const v = c.value(o);
    return typeof v === 'number' ? { value: v, type: Number } : { value: v, type: String };
  }));
  await writeXlsxFile([header, ...rows], {
    columns: COLUMNS.map(c => ({ width: c.width })),
    stickyRowsCount: 1,
  }).toFile(fileName);
}

export interface ShipRow { row: number; id: string; trackingCompany: string; trackingNumber: string }
export interface ParsedShipFile { rows: ShipRow[]; problems: string[]; noTrackingCount: number }

const COURIER_ALIASES: [RegExp, string][] = [
  [/^(cj|씨제이|대한통운|cj대한통운)/i, 'CJ대한통운'],
  [/^한진/, '한진택배'],
  [/^롯데/, '롯데택배'],
  [/^(우체국|우편)/, '우체국택배'],
  [/^로젠/, '로젠택배'],
  [/^경동/, '경동택배'],
];

/** 택배사 이름을 화면의 택배사 목록 이름으로 맞춘다(예: 'CJ', '대한통운' → 'CJ대한통운'). 모르는 이름은 그대로 둔다. */
export function normalizeCourier(v: string) {
  const s = v.replace(/\s+/g, '');
  if (!s) return '';
  if (SHIPPING_COURIERS.includes(s)) return s;
  for (const [re, name] of COURIER_ALIASES) if (re.test(s)) return name;
  return v.trim();
}

const cellText = (v: unknown) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v).trim();
};

/** 송장 엑셀 읽기. defaultCourier 는 택배사 칸이 빈 줄에 쓴다. */
export async function parseShipExcel(file: File, defaultCourier: string): Promise<ParsedShipFile> {
  const sheets = await readXlsxFile(file);
  const data = sheets[0]?.data || [];
  const problems: string[] = [];
  const headerIdx = data.findIndex(r => r.some(c => cellText(c).replace(/\s/g, '') === ORDER_ID_COL));
  if (headerIdx < 0) throw new Error(`첫 번째 시트에서 '${ORDER_ID_COL}' 열을 찾지 못했어요. 내려받은 엑셀 양식을 그대로 써 주세요.`);
  const header = data[headerIdx].map(c => cellText(c).replace(/\s/g, ''));
  const idCol = header.indexOf(ORDER_ID_COL);
  const courierCol = header.indexOf(COURIER_COL);
  const trackingCol = header.indexOf(TRACKING_COL);
  if (trackingCol < 0) throw new Error(`'${TRACKING_COL}' 열이 없어요. 내려받은 엑셀 양식을 그대로 써 주세요.`);

  const rows: ShipRow[] = [];
  const seen = new Set<string>();
  let noTrackingCount = 0;
  for (let i = headerIdx + 1; i < data.length; i++) {
    const r = data[i];
    const id = cellText(r[idCol]);
    const trackingNumber = cellText(r[trackingCol]).replace(/[\s-]/g, '');
    if (!id && !trackingNumber) continue;
    const rowNo = i + 1;
    if (!id) { problems.push(`${rowNo}행: 주문번호가 비어 있어요.`); continue; }
    if (!trackingNumber) { noTrackingCount++; continue; }
    if (seen.has(id)) { problems.push(`${rowNo}행: 주문번호 ${id}가 위에 이미 있어요.`); continue; }
    if (trackingNumber.length > 60) { problems.push(`${rowNo}행: 송장번호가 너무 길어요.`); continue; }
    const trackingCompany = normalizeCourier(courierCol >= 0 ? cellText(r[courierCol]) : '') || defaultCourier;
    if (!trackingCompany) { problems.push(`${rowNo}행: 택배사가 비어 있어요.`); continue; }
    seen.add(id);
    rows.push({ row: rowNo, id, trackingCompany, trackingNumber });
  }
  return { rows, problems, noTrackingCount };
}

/** 처리하지 못한 줄을 엑셀로(사유 포함) 내려받는다. 고친 뒤 다시 올리면 된다. */
export async function downloadFailedRows(rows: (ShipRow & { error: string })[], fileName: string) {
  const header = [ORDER_ID_COL, COURIER_COL, TRACKING_COL, '실패 사유'].map(v => ({ value: v, fontWeight: 'bold' as const, backgroundColor: '#FEF2F2' }));
  await writeXlsxFile([
    header,
    ...rows.map(r => [r.id, r.trackingCompany, r.trackingNumber, r.error].map(v => ({ value: v, type: String }))),
  ], { columns: [{ width: 26 }, { width: 12 }, { width: 18 }, { width: 40 }], stickyRowsCount: 1 }).toFile(fileName);
}
