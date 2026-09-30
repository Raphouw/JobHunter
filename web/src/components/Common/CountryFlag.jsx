import React from 'react';
import { Icon } from './Icons';

export function CountryFlag({ code, size = 20 }) {
  if (!code || code === 'ALL') return <Icon name="globe" size={size} />;
  const vertical = (colors) => colors.map((color, i) => <rect key={color} x={i * 10} width="10" height="20" fill={color} />);
  const horizontal = (colors) => colors.map((color, i) => <rect key={color} y={i * 20 / colors.length} width="30" height={20 / colors.length} fill={color} />);
  const flags = {
    CH: <><rect width="30" height="20" fill="#da291c" /><path d="M13 4h4v4h4v4h-4v4h-4v-4H9V8h4Z" fill="#fff" /></>,
    FR: vertical(['#002654', '#fff', '#ed2939']),
    IT: vertical(['#009246', '#fff', '#ce2b37']),
    BE: vertical(['#111', '#fdda24', '#ef3340']),
    DE: horizontal(['#111', '#dd0000', '#ffce00']),
    LU: horizontal(['#ed2939', '#fff', '#00a1de']),
    ES: <><rect width="30" height="20" fill="#aa151b" /><rect y="5" width="30" height="10" fill="#f1bf00" /><path d="M8 8h4v5l-2 1-2-1Z" fill="#aa151b" /><path d="M7 7h6M7 9v4m6-4v4" stroke="#fff" strokeWidth=".8" /></>,
    EU: <><rect width="30" height="20" fill="#003399" />{Array.from({length:12}, (_,i) => <path key={i} d="m0-.9.21.62h.66l-.53.39.2.62L0 .35l-.53.38.2-.62-.53-.39h.65Z" fill="#ffcc00" transform={`translate(${15 + 6 * Math.sin(i * Math.PI / 6)} ${10 - 6 * Math.cos(i * Math.PI / 6)})`} />)}</>,
  };
  return <svg className="jh-country-flag" width={size} height={size * 2 / 3} viewBox="0 0 30 20" role="img" aria-label={`Drapeau ${code}`} focusable="false">{flags[code] || flags.EU}</svg>;
}
