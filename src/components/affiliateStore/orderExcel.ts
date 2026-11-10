import writeXlsxFile from 'write-excel-file/browser';
import readXlsxFile from 'read-excel-file/browser';
import { COURIER_CODES, courierCodeOf, ORDER_STATUS_LABEL, type StoreOrder } from '../../services/affiliateStoreService';

/**
 * 브랜드 주문 엑셀 처리.
 *   내려받기: 주문 목록(화면에서 고른 필터 · 정렬 그대로) + 두 번째 시트 '택배사 코드표'.
 *     맨 오른쪽 노란 칸 '택배사 코드' · '송장번호'를 채워 다시 올리면 일괄 발송된다.
 *   택배사 규칙: 코드 두 자리(01 CJ대한통운, 02 한진택배 …, COURIER_CODES). 엑셀이 01을 1로 바꿔도 같은 코드로 읽는다. '기타'는 없다.
 *     예전 양식처럼 택배사 이름을 적어도 읽지만, 코드표에 없는 값은 오류로 보여 준다.
 *   올리기: 첫 시트에서 '주문번호' 머리글 줄을 찾고, 송장번호가 빈 줄은 건너뛴다.
 */

const ORDER_ID_COL = '주문번호';
const COURIER_COL = '택배사 코드';
const TRACKING_COL = '송장번호';

const fmt = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const COLUMNS: { title: string; width: number; input?: boolean; value: (o: StoreOrder) => string | number }[] = [
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
  { title: COURIER_COL, width: 12, input: true, value: o => courierCodeOf(o.trackingCompany) || (o.trackingCompany || '') },
  { title: TRACKING_COL, width: 20, input: true, value: o => o.trackingNumber || '' },
];

const INPUT_HEAD = '#FDE68A';
const INPUT_CELL = '#FFFBEB';

function codeSheet() {
  return {
    sheet: '택배사 코드표',
    columns: [{ width: 12 }, { width: 18 }],
    data: [
      [{ value: '택배사 코드', fontWeight: 'bold' as const, backgroundColor: INPUT_HEAD }, { value: '택배사', fontWeight: 'bold' as const, backgroundColor: INPUT_HEAD }],
      ...COURIER_CODES.map(c => [{ value: c.code, type: String }, { value: c.name, type: String }]),
      [],
      [{ value: '주문 시트의 노란 칸에 택배사 코드(두 자리)와 송장번호를 적어 올려 주세요.', type: String }],
      [{ value: '송장번호가 빈 줄은 발송 처리하지 않아요.', type: String }],
    ],
  };
}

export async function downloadOrdersExcel(orders: StoreOrder[], fileName: string) {
  const header = COLUMNS.map(c => ({ value: c.title, fontWeight: 'bold' as const, backgroundColor: c.input ? INPUT_HEAD : '#EEF2F7' }));
  const rows = orders.map(o => COLUMNS.map(c => {
    const v = c.value(o);
    const style = c.input ? { backgroundColor: INPUT_CELL } : {};
    return typeof v === 'number' ? { value: v, type: Number, ...style } : { value: v, type: String, ...style };
  }));
  await writeXlsxFile([
    { sheet: '주문', data: [header, ...rows], columns: COLUMNS.map(c => ({ width: c.width })), stickyRowsCount: 1 },
    codeSheet(),
  ]).toFile(fileName);
}

export interface ShipRow { row: number; id: string; trackingCompany: string; trackingNumber: string }
export interface ParsedShipFile { rows: ShipRow[]; problems: string[]; noTrackingCount: number }

/**
 * 택배사 칸 값을 택배사 이름으로. 코드(01 · 1 · '01')가 기본이고, 이름도 받는다. 모르면 ''.
 */
export function courierFromCell(v: string) {
  const s = v.replace(/\s+/g, '');
  if (!s) return '';
  if (/^\d{1,2}$/.test(s)) return COURIER_CODES.find(c => c.code === s.padStart(2, '0'))?.name || '';
  const byName = COURIER_CODES.find(c => c.name.replace(/\s+/g, '') === s);
  if (byName) return byName.name;
  const aliases: [RegExp, string][] = [
    [/^(cj|씨제이|대한통운)/i, 'CJ대한통운'], [/^한진/, '한진택배'], [/^롯데/, '롯데택배'],
    [/^(우체국|우편|epost)/i, '우체국택배'], [/^로젠/, '로젠택배'], [/^경동/, '경동택배'],
    [/^대신/, '대신택배'], [/^일양/, '일양로지스'], [/^합동/, '합동택배'], [/^천일/, '천일택배'],
    [/^건영/, '건영택배'], [/^(cu|씨유)/i, 'CU 편의점택배'], [/^(gs|지에스|cvsnet)/i, 'GS25 편의점택배'],
    [/^한의사랑/, '한의사랑택배'], [/^slx/i, 'SLX택배'], [/^홈픽/, '홈픽'], [/^우리/, '우리택배'],
    [/^용마/, '용마로지스'], [/^농협/, '농협택배'], [/^세방/, '세방택배'],
  ];
  for (const [re, name] of aliases) if (re.test(s)) return name;
  return '';
}

const cellText = (v: unknown) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v).trim();
};
const norm = (v: unknown) => cellText(v).replace(/\s/g, '');

/** 송장 엑셀 읽기. defaultCourier 는 택배사 코드 칸이 빈 줄에 쓴다(빈 문자열이면 빈 칸을 오류로 본다). */
export async function parseShipExcel(file: File, defaultCourier: string): Promise<ParsedShipFile> {
  const sheets = await readXlsxFile(file);
  const data = sheets[0]?.data || [];
  const problems: string[] = [];
  const headerIdx = data.findIndex(r => r.some(c => norm(c) === ORDER_ID_COL));
  if (headerIdx < 0) throw new Error(`첫 번째 시트에서 '${ORDER_ID_COL}' 열을 찾지 못했어요. 내려받은 엑셀 양식을 그대로 써 주세요.`);
  const header = data[headerIdx].map(norm);
  const idCol = header.indexOf(ORDER_ID_COL);
  // '택배사 코드'(지금 양식) 또는 '택배사'(예전 양식)
  const courierCol = header.findIndex(h => h === '택배사코드' || h === '택배사');
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
    const raw = courierCol >= 0 ? cellText(r[courierCol]) : '';
    const trackingCompany = raw ? courierFromCell(raw) : defaultCourier;
    if (raw && !trackingCompany) { problems.push(`${rowNo}행: 택배사 코드 '${raw}'는 코드표에 없어요.`); continue; }
    if (!trackingCompany) { problems.push(`${rowNo}행: 택배사 코드가 비어 있어요.`); continue; }
    seen.add(id);
    rows.push({ row: rowNo, id, trackingCompany, trackingNumber });
  }
  return { rows, problems, noTrackingCount };
}

/** 처리하지 못한 줄을 엑셀로(사유 포함) 내려받는다. 같은 머리글이라 고친 뒤 그대로 다시 올리면 된다. */
export async function downloadFailedRows(rows: (ShipRow & { error: string })[], fileName: string) {
  const header = [ORDER_ID_COL, COURIER_COL, TRACKING_COL, '실패 사유'].map(v => ({ value: v, fontWeight: 'bold' as const, backgroundColor: '#FEF2F2' }));
  await writeXlsxFile([
    {
      sheet: '실패',
      data: [header, ...rows.map(r => [r.id, courierCodeOf(r.trackingCompany) || r.trackingCompany, r.trackingNumber, r.error].map(v => ({ value: v, type: String })))],
      columns: [{ width: 26 }, { width: 12 }, { width: 18 }, { width: 40 }],
      stickyRowsCount: 1,
    },
    codeSheet(),
  ]).toFile(fileName);
}
