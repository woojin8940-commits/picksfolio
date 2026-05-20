export const formatNumberWithCommas = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '';
  const numbers = String(value).replace(/[^0-9]/g, '');
  if (!numbers) return '';
  return numbers.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

export const stripCommas = (value: string): string => {
  return value.replace(/[^0-9]/g, '');
};

export const formatKRW = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined) return '0원';
  const num = typeof value === 'string' ? Number(value.replace(/[^0-9]/g, '')) : value;
  if (isNaN(num)) return '0원';
  return `${formatNumberWithCommas(num)}원`;
};
