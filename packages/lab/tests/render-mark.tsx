import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { SplitMark } from '../src/ui/LensSwitcher.tsx';
const states: [string, any, any][] = [
  ['Both divisions', 'combined', { eng: true, amg: true }],
  ['Engineering lens', 'eng', { eng: true, amg: true }],
  ['Asset Management lens', 'amg', { eng: true, amg: true }],
  ['Engineering-only person', 'eng', { eng: true, amg: false }],
];
let x = 0, out = '';
for (const [label, lens, can] of states) {
  const svg = renderToStaticMarkup(<SplitMark lens={lens} canSee={can} size={150} />).replace('<svg ', `<svg x="${x + 25}" y="30" `);
  out += svg + `<text x="${x + 100}" y="205" font-family="sans-serif" font-size="12" text-anchor="middle" fill="#111">${label}</text>`;
  x += 200;
}
writeFileSync('assets/lens-states.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="230" viewBox="0 0 800 230"><rect width="800" height="230" fill="#f7f7f5"/>${out}</svg>`);
