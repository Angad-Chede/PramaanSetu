import { BadgeCheck, FileLock2, FlaskConical, ShieldCheck } from "lucide-react";

export type EvidencePassport = {
  reference: string;
  department: string;
  startup: string;
  measure: string;
  unit: string;
  baseline: number;
  pilot: number;
  relative: number;
  ciLow: number;
  ciHigh: number;
  score: number;
  band: string;
  method: string;
};

/** How the Evidence Confidence Score is built: the five parts and their weights out of 100. */
const PARTS = [
  { label: "Effect attainment", weight: 30 },
  { label: "Statistical confidence", weight: 25 },
  { label: "Data quality", weight: 20 },
  { label: "Protocol adherence", weight: 15 },
  { label: "Independent validation", weight: 10 },
];

const RECORD = [
  { icon: FileLock2, label: "Dataset hash locked", detail: "SHA-256 recorded at design freeze" },
  { icon: FlaskConical, label: "Pre-registered analysis", detail: "Run as frozen, nothing chosen after" },
  { icon: ShieldCheck, label: "Validator signed", detail: "Independent Validator, five checks" },
];

function fixed(value: number, digits = 1) {
  return value.toFixed(digits);
}

/** The evidence report as the product shows it, from the newest validated passport. */
export function EvidenceWindow({ passport }: { passport: EvidencePassport }) {
  const top = Math.max(passport.baseline, passport.pilot) * 1.12;
  const radius = 64;
  const length = 2 * Math.PI * radius;

  return (
    <div data-ui className="overflow-hidden rounded-[18px] bg-[#fbfaf7] text-ink shadow-[0_0_0_1px_rgba(21,19,15,0.08),0_40px_120px_-30px_rgba(8,14,60,0.55)]">
      <div className="flex items-center gap-3 border-b border-ink/8 px-5 py-3.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-ink/12" />
          <span className="size-2.5 rounded-full bg-ink/12" />
          <span className="size-2.5 rounded-full bg-ink/12" />
        </span>
        <span className="truncate font-mono text-[11.5px] text-ink/45">pramaansetu / evidence / {passport.reference}</span>
        <span className="ml-auto hidden items-center gap-1.5 rounded-full bg-[#e7f3ea] px-2.5 py-1 text-[11.5px] font-medium text-[#1d6b3a] sm:inline-flex">
          <BadgeCheck className="size-3.5" /> Validated
        </span>
      </div>

      <div className="grid lg:grid-cols-[1.15fr_1fr]">
        {/* the result */}
        <div className="flex flex-col gap-8 p-6 sm:p-9">
          <div className="flex flex-col gap-2">
            <p className="font-mono text-[11.5px] tracking-wide text-ink/45 uppercase">Evidence report</p>
            <h3 className="font-serif text-[28px] leading-[1.1] tracking-[-0.02em] sm:text-[34px]">{passport.measure}</h3>
            <p className="text-[14px] text-ink/55">{passport.department}</p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex items-end gap-4">
              <span className="font-serif text-[64px] leading-none tracking-[-0.04em] text-vermilion sm:text-[84px]">{fixed(passport.relative)}%</span>
              <span className="pb-2 text-[13px] leading-snug text-ink/55">
                {passport.unit},
                <br /> before against during the pilot
              </span>
            </div>
            {/* before and after on one scale, with the interval of the change */}
            <div className="flex flex-col gap-3 pt-2">
              {[
                { label: "Before the pilot", value: passport.baseline, tone: "bg-ink/25" },
                { label: "During the pilot", value: passport.pilot, tone: "bg-cobalt" },
              ].map((row) => (
                <div key={row.label} className="grid grid-cols-[120px_1fr_56px] items-center gap-3 text-[13px]">
                  <span className="text-ink/55">{row.label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-ink/6">
                    <span className={"block h-full rounded-full " + row.tone} style={{ width: (row.value / top) * 100 + "%" }} />
                  </span>
                  <span className="text-right font-mono tabular-nums">{fixed(row.value)}%</span>
                </div>
              ))}
            </div>
            <p className="border-t border-ink/8 pt-4 text-[13px] leading-relaxed text-ink/55">
              95% interval of the change: {fixed(passport.ciLow)} to {fixed(passport.ciHigh)} points. {passport.method}.
            </p>
          </div>
        </div>

        {/* the score and its record */}
        <div className="flex flex-col gap-7 border-t border-ink/8 bg-[#f5f2ec] p-6 sm:p-9 lg:border-t-0 lg:border-l">
          <div className="flex items-center gap-6">
            <div className="relative size-[150px] shrink-0">
              <svg viewBox="0 0 160 160" className="size-full -rotate-90" aria-hidden>
                <circle cx="80" cy="80" r={radius} fill="none" stroke="rgba(21,19,15,0.08)" strokeWidth="10" />
                <circle cx="80" cy="80" r={radius} fill="none" stroke="var(--color-cobalt)" strokeWidth="10" strokeLinecap="round" strokeDasharray={length} strokeDashoffset={length * (1 - passport.score / 100)} />
              </svg>
              <div className="absolute inset-0 grid place-items-center text-center">
                <div>
                  <p className="font-serif text-[44px] leading-none tracking-[-0.03em]">{fixed(passport.score)}</p>
                  <p className="mt-1 text-[11px] text-ink/45">of 100</p>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-[13px] text-ink/55">Evidence Confidence Score</p>
              <p className="font-serif text-[26px] leading-none">{passport.band} evidence</p>
            </div>
          </div>
          <ul className="flex flex-col gap-2">
            {PARTS.map((part) => (
              <li key={part.label} className="grid grid-cols-[1fr_auto] items-center gap-3 text-[13px]">
                <span className="text-ink/60">{part.label}</span>
                <span className="font-mono text-[12px] text-ink/40 tabular-nums">weight {part.weight}</span>
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-2.5 border-t border-ink/8 pt-5">
            {RECORD.map((item) => (
              <li key={item.label} className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-cobalt text-white">
                  <item.icon className="size-4" />
                </span>
                <span className="flex flex-col">
                  <span className="text-[13.5px] font-medium">{item.label}</span>
                  <span className="text-[12px] text-ink/50">{item.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
