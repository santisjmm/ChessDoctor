import { useId } from 'react';

/** ChessDoctor mark: a knight with a small cross, on a green tile (same style as the Review app's mark). */
export function LogoMark({ size = 28 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden focusable="false">
      <defs>
        <linearGradient id={`lg${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#96c95f" />
          <stop offset="1" stopColor="#5f9135" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#lg${id})`} />
      <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="14.3" fill="none" stroke="#fff" strokeOpacity=".18" strokeWidth="1.5" />
      <g fill="#fff">
        <path d="M17 50C16.5 43 19.5 38 25 33.5C21 34.5 17 35.5 14.5 35.2C12 35 11 33 11.6 31C13 26 17 21.5 21 18.5L23 11.5L27.5 15.5C37 15 44 24 43.5 37L43 50Z" />
        <rect x="13" y="50" width="32" height="5" rx="2.5" />
      </g>
      <circle cx="26.6" cy="24.2" r="1.9" fill="#6f9f40" />
      <g fill="#fff">
        <rect x="47" y="9" width="6" height="18" rx="1.5" />
        <rect x="41" y="15" width="18" height="6" rx="1.5" />
      </g>
    </svg>
  );
}
