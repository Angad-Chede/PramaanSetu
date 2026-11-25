import { cn } from "@/lib/utils";

/**
 * A rubber stamp in vermilion, as a government office signs: the role round the rim,
 * the act across a band in the middle. The ink is a little uneven, as a real one is.
 */
export function Seal({ role, act, initials, id, className }: { role: string; act: string; initials: string; id: string; className?: string }) {
  return (
    <svg viewBox="0 0 220 220" role="img" aria-label={`${role}: ${act}`} className={cn("text-vermilion", className)}>
      <defs>
        {/* the rim text runs on two arcs that stop short of the band: the role over the top, the name under it */}
        <path id={`top-${id}`} d="M33.1,87.9 A80,80 0 0,1 186.9,87.9" />
        <path id={`bottom-${id}`} d="M22.5,135.1 A91,91 0 0,0 197.5,135.1" />
        <filter id={`ink-${id}`} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed={initials.charCodeAt(0)} result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.75" result="speckle" />
          <feComposite in="SourceGraphic" in2="speckle" operator="in" result="inked" />
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="1" seed="3" result="warp" />
          <feDisplacementMap in="inked" in2="warp" scale="1.8" />
        </filter>
      </defs>
      <g filter={`url(#ink-${id})`} fill="currentColor" stroke="currentColor">
        <circle cx="110" cy="110" r="104" fill="none" strokeWidth="5" />
        <circle cx="110" cy="110" r="66" fill="none" strokeWidth="1.6" />
        <text fontFamily="var(--font-geist-mono)" fontSize="12" letterSpacing="1.8" textAnchor="middle" stroke="none">
          <textPath href={`#top-${id}`} startOffset="50%">
            {role.toUpperCase()}
          </textPath>
        </text>
        <text fontFamily="var(--font-geist-mono)" fontSize="12" letterSpacing="2.6" textAnchor="middle" stroke="none">
          <textPath href={`#bottom-${id}`} startOffset="50%">
            ★ PRAMAANSETU ★
          </textPath>
        </text>
        <rect x="14" y="94" width="192" height="32" stroke="none" />
        <text x="110" y="116" textAnchor="middle" fontFamily="var(--font-geist-sans)" fontWeight="700" fontSize="15" letterSpacing="3" fill="#f3efe7" stroke="none">
          {act.toUpperCase()}
        </text>
        <text x="110" y="82" textAnchor="middle" fontFamily="var(--font-geist-serif)" fontSize="26" stroke="none">
          {initials}
        </text>
        <text x="110" y="152" textAnchor="middle" fontFamily="var(--font-geist-mono)" fontSize="10" letterSpacing="2" stroke="none">
          2026
        </text>
      </g>
    </svg>
  );
}
