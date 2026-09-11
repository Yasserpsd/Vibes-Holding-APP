/** Thousands separators without relying on Intl (partial on Hermes). */
export function formatNumber(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatMillionsSar(millions: number): string {
  return `${formatNumber(millions)} مليون ريال`;
}
