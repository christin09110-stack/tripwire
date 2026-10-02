import React from 'react';
const P = {
  scan: <><circle cx="12" cy="12" r="9" /><path d="M12 12l5-5" /><circle cx="12" cy="12" r="1.5" /></>,
  spin: <path className="spin" style={{ transformOrigin: '12px 12px' }} d="M21 12a9 9 0 1 1-6.2-8.55" />,
  edit: <><path d="M4 20h4l11-11-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
};
export function Icon({ name }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name]}</svg>;
}
