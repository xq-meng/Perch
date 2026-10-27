const stroke = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const fill = (body, viewBox = '0 0 24 24') => `<svg viewBox="${viewBox}" aria-hidden="true">${body}</svg>`;
export const icons = {
  check: stroke('<path d="m5 12 4 4L19 6"/>'),
  sun: stroke('<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>'),
  moon: stroke('<path d="M20.5 14a8.6 8.6 0 0 1-10.6-10.6A8.8 8.8 0 1 0 20.5 14Z"/>'),
  monitor: stroke('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>'),
  'arrow-right': stroke('<path d="M5 12h14m-5-5 5 5-5 5"/>'),
  chevron: stroke('<path d="m7 10 5 5 5-5"/>'),
  plus: stroke('<path d="M12 5v14M5 12h14"/>'),
  edit: stroke('<path d="m15.5 4.5 4 4M4 20l4.5-1L20 7.5a2.8 2.8 0 0 0-4-4L4.5 15Z"/>'),
  close: stroke('<path d="m6 6 12 12M6 18 18 6"/>'),
  more: fill('<g fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></g>'),
  trash: stroke('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>'),
  sliders: stroke('<path d="M4 7h8m4 0h4M4 17h3m4 0h9"/><circle cx="14" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  lock: stroke('<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>'),
  spark: stroke('<path d="M12 2c0 6-4 10-10 10 6 0 10 4 10 10 0-6 4-10 10-10-6 0-10-4-10-10Z"/>'),
  google: fill('<path fill="#4285f4" d="M22 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.6a4.8 4.8 0 0 1-2.1 3.2v2.6h3.4c2-1.8 3.1-4.5 3.1-7.7Z"/><path fill="#34a853" d="M12 22c2.8 0 5.2-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-5-1.9-5.8-4.3H2.7v2.7A10.4 10.4 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.2 13.6a6.2 6.2 0 0 1 0-3.2V7.7H2.7a10 10 0 0 0 0 8.6Z"/><path fill="#ea4335" d="M12 6.1c1.5 0 2.8.5 3.9 1.5L18.8 4A10 10 0 0 0 2.7 7.7l3.5 2.7C7 8 9.3 6.1 12 6.1Z"/>'),
  bing: fill('<path d="M5 2v16l5 4 10-6v-4l-9-4 2 5 3 1-6 4V4Z" fill="#58a7a5"/>'),
  baidu: fill('<g fill="#557cc8"><ellipse cx="5" cy="8" rx="2.3" ry="3" transform="rotate(-25 5 8)"/><ellipse cx="10" cy="4" rx="2.3" ry="3"/><ellipse cx="16" cy="5" rx="2.3" ry="3" transform="rotate(20 16 5)"/><ellipse cx="21" cy="10" rx="2.2" ry="3" transform="rotate(30 21 10)"/><path d="M5 17c0-3 4-7 7-7s7 4 7 7-3 4-7 3-7 0-7-3Z"/></g>'),
  duckduckgo: fill('<circle cx="12" cy="12" r="11" fill="#df8158"/><path d="M9 20V9c0-5 7-5 7 0v6l3 2-4 1v2" fill="#fff"/><path d="m14 11 7 1-6 3" fill="#e8b54d"/><circle cx="14" cy="8" r="1" fill="#354731"/><path d="m9 16 3 2-3 2m6-4-3 2 3 2" fill="#65a16a"/>'),
};
