/**
 * Line-art illustrations in the brand style: charcoal strokes, lime fills, mint washes.
 * All decorative (aria-hidden); the surrounding copy carries the meaning.
 */

const INK = '#151515';
const LIME = '#C1F11D';
const MINT = '#EBF9CF';
const CREAM = '#FFFEE9';
const SKIN = '#FFE0B2';

type Svg = { className?: string };

function Windows({ x, y, cols, rows, w = 10, h = 9, gapX = 14, gapY = 14 }: { x: number; y: number; cols: number; rows: number; w?: number; h?: number; gapX?: number; gapY?: number }) {
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push(<rect key={`${r}-${c}`} x={x + c * gapX} y={y + r * gapY} width={w} height={h} rx={1.5} />);
  return (
    <g fill="none" stroke={INK} strokeWidth={1.2} opacity={0.5}>
      {cells}
    </g>
  );
}

/** Side view of a CNG auto-rickshaw ("Tesla"), facing left, drawn in a 212x148 box (wheels touch y=147). */
export function AutoRickshaw({ x = 0, y = 0, scale = 1, withDriver = true, withRiders = true }: { x?: number; y?: number; scale?: number; withDriver?: boolean; withRiders?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M16 96 C14 44 46 8 100 6 L168 6 C192 6 206 22 206 46 L206 96 Z" fill={LIME} stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
      <path d="M0 128 C0 106 8 94 30 92 L204 92 C210 92 212 98 212 106 L212 128 Z" fill={LIME} stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
      <path d="M34 92 C36 56 54 30 84 26 L84 92 Z" fill="#fff" stroke={INK} strokeWidth={1.8} />
      <path d="M98 26 L168 26 C184 26 194 36 194 54 L194 92 L98 92 Z" fill="#fff" stroke={INK} strokeWidth={1.8} />
      {withDriver && (
        <g stroke={INK} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="64" cy="52" r="8" fill={SKIN} />
          <path d="M56 49 C57 42 71 42 72 49" fill={INK} />
          <path d="M52 92 C52 76 57 66 64 66 C71 66 76 76 76 92" fill={INK} />
          <path d="M54 76 L42 70" fill="none" strokeWidth={2.2} />
        </g>
      )}
      {withRiders && (
        <g stroke={INK} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="124" cy="54" r="7.5" fill={SKIN} />
          <path d="M116.5 52 C117 45 131 45 131.5 52" fill={INK} />
          <path d="M112 92 C112 76 117 68 124 68 C131 68 136 76 136 92" fill={MINT} />
          <circle cx="160" cy="56" r="7.5" fill={SKIN} />
          <path d="M152 53 C153 47 167 47 168 53 L168 62" fill={INK} />
          <path d="M148 92 C148 78 153 70 160 70 C167 70 172 78 172 92" fill="#fff" />
        </g>
      )}
      <g stroke={INK} strokeWidth={1.2} opacity={0.6}>
        <line x1="110" y1="28" x2="110" y2="90" />
        <line x1="142" y1="28" x2="142" y2="90" />
        <line x1="178" y1="30" x2="178" y2="90" />
        <line x1="100" y1="44" x2="192" y2="44" />
      </g>
      <line x1="91" y1="8" x2="91" y2="94" stroke={INK} strokeWidth={2} />
      <line x1="6" y1="112" x2="206" y2="112" stroke={INK} strokeWidth={1.2} />
      <circle cx="9" cy="104" r="5" fill="#fff" stroke={INK} strokeWidth={1.6} />
      <rect x="188" y="97" width="20" height="8" rx="3" fill={CREAM} stroke={INK} strokeWidth={1.4} />
      <circle cx="40" cy="130" r="17" fill={INK} />
      <circle cx="40" cy="130" r="9" fill="#fff" stroke={INK} strokeWidth={2} />
      <circle cx="40" cy="130" r="2.5" fill={INK} />
      <circle cx="170" cy="130" r="17" fill={INK} />
      <circle cx="170" cy="130" r="9" fill="#fff" stroke={INK} strokeWidth={2} />
      <circle cx="170" cy="130" r="2.5" fill={INK} />
    </g>
  );
}

function Tree({ x, y, r = 16 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y + r * 1.6} stroke={INK} strokeWidth={1.5} />
      <circle cx={x} cy={y} r={r} fill={LIME} stroke={INK} strokeWidth={1.5} />
      <circle cx={x + r * 0.8} cy={y + r * 0.6} r={r * 0.55} fill={MINT} stroke={INK} strokeWidth={1.5} />
    </g>
  );
}

/** Mission banner: Dhaka skyline with a pooled Tesla and a passenger waving it down. */
export function CityScene({ className }: Svg) {
  return (
    <svg className={className} viewBox="0 0 540 330" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="270" cy="225" rx="175" ry="110" fill={MINT} opacity={0.85} />
      <rect x="170" y="80" width="85" height="180" rx="3" fill="#fff" stroke={INK} strokeWidth={1.5} />
      <Windows x={182} y={92} cols={4} rows={6} />
      <rect x="255" y="50" width="46" height="210" rx="2" fill={CREAM} stroke={INK} strokeWidth={1.5} />
      <line x1="270" y1="56" x2="270" y2="255" stroke={INK} strokeWidth={1} strokeDasharray="4 3" />
      <line x1="286" y1="56" x2="286" y2="255" stroke={INK} strokeWidth={1} strokeDasharray="4 3" />
      <rect x="301" y="120" width="70" height="140" rx="3" fill="#fff" stroke={INK} strokeWidth={1.5} />
      <Windows x={312} y={132} cols={3} rows={5} w={9} h={8} gapX={16} gapY={16} />
      <rect x="118" y="160" width="52" height="100" rx="3" fill="#fff" stroke={INK} strokeWidth={1.5} />
      <Windows x={127} y={172} cols={2} rows={4} gapX={20} gapY={18} />
      <Tree x={110} y={240} r={15} />
      <Tree x={420} y={236} r={17} />
      <Tree x={444} y={254} r={10} />
      <line x1="80" y1="285" x2="470" y2="285" stroke={INK} strokeWidth={1.5} />
      <AutoRickshaw x={166} y={145} scale={0.95} />
      <g stroke={INK} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="428" cy="198" r="7" fill={SKIN} />
        <path d="M422 194 C423 188 433 188 435 194" fill={INK} />
        <path d="M420 206 L436 206 L439 238 L417 238 Z" fill={INK} />
        <path d="M436 210 L450 190" fill="none" strokeWidth={2.4} />
        <path d="M421 238 L417 282 M434 238 L438 282" fill="none" strokeWidth={2.4} />
        <ellipse cx="415" cy="284" rx="4" ry="1.6" fill={INK} />
        <ellipse cx="440" cy="284" rx="4" ry="1.6" fill={INK} />
      </g>
      <path d="M452 176 l3 6 6 3 -6 3 -3 6 -3 -6 -6 -3 6 -3 Z" fill={LIME} stroke={INK} strokeWidth={1.2} />
    </svg>
  );
}

/** Service card: a pooled ride, driver at the wheel and two riders. */
export function PooledRideArt({ className }: Svg) {
  return (
    <svg className={className} viewBox="0 0 240 150" fill="none" aria-hidden="true">
      <path d="M18 115 C30 80 75 75 110 75 C145 75 190 85 210 120 L210 135 L18 135 Z" fill={LIME} />
      <path d="M35 125 C45 95 85 90 120 90 C155 90 190 98 205 125" stroke={INK} strokeWidth={2.5} />
      <circle cx="90" cy="80" r="26" stroke={INK} strokeWidth={7} />
      <line x1="90" y1="80" x2="90" y2="106" stroke={INK} strokeWidth={4} />
      <line x1="64" y1="80" x2="116" y2="80" stroke={INK} strokeWidth={4} />
      <g stroke={INK} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M88 45 C88 38 98 34 105 34 C112 34 122 38 122 45" fill={INK} />
        <circle cx="105" cy="52" r="14" fill="#fff" />
        <path d="M100 52 C103 54 107 54 110 52" />
        <path d="M98 56 C102 59 108 59 112 56" fill={INK} />
        <path d="M95 66 L80 95 L95 105 L115 88" fill="#fff" />
        <path d="M115 66 L130 95 L115 105" fill="#fff" />
      </g>
      <g stroke={INK} strokeWidth={1.8}>
        <circle cx="168" cy="62" r="11" fill="#fff" />
        <path d="M158 58 C160 52 176 52 178 58" fill={INK} />
        <path d="M155 85 C158 75 178 75 181 85" fill={INK} />
        <circle cx="200" cy="66" r="9" fill="#fff" />
        <path d="M192 62 C194 57 206 57 208 62" fill={INK} />
        <path d="M189 86 C192 78 208 78 211 86" fill="#fff" />
      </g>
    </svg>
  );
}

/** Service card: three vehicle classes, one formula. */
export function VehicleClassesArt({ className }: Svg) {
  return (
    <svg className={className} viewBox="0 0 240 150" fill="none" aria-hidden="true">
      <path d="M40 40 L200 34 L214 130 L30 130 Z" fill={LIME} />
      <rect x="44" y="44" width="152" height="80" rx="10" fill="#fff" stroke={INK} strokeWidth={2.2} />
      <AutoRickshaw x={62} y={56} scale={0.4} withRiders={false} />
      <g stroke={INK} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="168" cy="104" r="10" fill="#fff" />
        <circle cx="190" cy="104" r="10" fill="#fff" />
        <path d="M168 104 L178 86 L190 104 M176 86 L186 86" />
        <circle cx="182" cy="74" r="5" fill={SKIN} />
      </g>
      <g stroke={INK} strokeWidth={1.6} strokeLinecap="round">
        <circle cx="72" cy="30" r="9" fill="#fff" />
        <path d="M68 30 L71 33 L77 27" />
        <circle cx="120" cy="24" r="9" fill="#fff" />
        <path d="M116 24 L119 27 L125 21" />
        <circle cx="168" cy="28" r="9" fill="#fff" />
        <path d="M164 28 L167 31 L173 25" />
      </g>
    </svg>
  );
}

/** Service card: TeslaPay wallet on a phone. */
export function WalletArt({ className }: Svg) {
  return (
    <svg className={className} viewBox="0 0 240 150" fill="none" aria-hidden="true">
      <path d="M35 50 L195 55 L215 130 L25 130 Z" fill={LIME} />
      <g stroke={INK} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M35 60 L180 65 L195 125 L30 125 Z" fill="#fff" />
        <circle cx="85" cy="65" r="13" fill="#fff" />
        <path d="M78 60 C80 54 94 54 96 60" fill={INK} />
        <path d="M82 66 C85 68 90 68 93 66" />
        <path d="M70 78 L65 110 L110 110 L105 78 Z" fill="#fff" />
        <path d="M105 82 L130 75 L125 65" strokeWidth={2.5} />
        <rect x="118" y="44" width="40" height="62" rx="6" fill="#fff" />
        <rect x="123" y="52" width="30" height="18" rx="3" fill={LIME} />
        <line x1="126" y1="78" x2="150" y2="78" strokeWidth={1.5} />
        <line x1="126" y1="85" x2="142" y2="85" strokeWidth={1.5} />
        <circle cx="138" cy="97" r="3" fill={INK} />
        <circle cx="192" cy="88" r="18" fill="#fff" strokeWidth={5} />
        <path d="M186 88 L191 93 L199 83" strokeWidth={2.5} />
      </g>
      <text x="138" y="65" textAnchor="middle" fontSize="9" fontWeight="900" fill={INK}>
        ৳
      </text>
    </svg>
  );
}

/** Safety pact roundel: drivers, passengers and TeslaPool around one centre. */
export function SafetyRing({ className }: Svg) {
  return (
    <div className={`relative flex h-44 w-44 items-center justify-center ${className ?? ''}`} aria-hidden="true">
      <svg className="h-full w-full -rotate-90 motion-safe:animate-[spin_40s_linear_infinite]" viewBox="0 0 160 160">
        <circle cx="80" cy="80" r="65" fill="none" stroke={LIME} strokeWidth={16} />
        <line x1="80" y1="15" x2="80" y2="30" stroke="#fff" strokeWidth={3} />
        <line x1="23" y1="112" x2="36" y2="105" stroke="#fff" strokeWidth={3} />
        <line x1="137" y1="112" x2="124" y2="105" stroke="#fff" strokeWidth={3} />
        <circle cx="80" cy="80" r="57" fill="none" stroke={INK} strokeWidth={1.5} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full border-[1.5px] border-dark bg-white">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
            <path d="M5 6.5h14" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
            <path d="M12 6.5v8.5" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
            <circle cx="12" cy="19.5" r="2.2" fill={INK} />
          </svg>
        </span>
      </div>
      <span className="absolute top-2.5 text-[10px] font-bold uppercase tracking-wide text-dark">Drivers</span>
      <span className="absolute bottom-2.5 text-[10px] font-bold uppercase tracking-wide text-dark">Passengers</span>
      <span className="absolute -right-3 rotate-90 text-[9px] font-bold uppercase tracking-wide text-dark">TeslaPool</span>
    </div>
  );
}

/** Lime lightning/zigzag backdrop behind the safety portrait. */
export function ZigzagBackdrop({ className }: Svg) {
  return (
    <svg className={className} viewBox="0 0 240 240" aria-hidden="true">
      <polygon fill={LIME} points="120,20 180,60 150,110 210,150 180,210 130,170 70,220 90,140 30,100 90,70" />
      <polygon fill={LIME} opacity={0.5} points="196,6 232,26 214,52 236,70 204,74 190,44" />
    </svg>
  );
}

/** Newsroom feature: a passenger meeting their Tesla at the kerb. */
export function NewsFeatureArt({ className }: Svg) {
  return (
    <svg className={className} viewBox="0 0 340 320" fill="none" aria-hidden="true">
      <rect x="30" y="20" width="280" height="270" rx="16" fill={MINT} fillOpacity={0.6} />
      <rect x="240" y="60" width="40" height="65" rx="8" fill={LIME} />
      <path d="M40 272 Q140 280 250 270" stroke={INK} strokeWidth={2.5} strokeLinecap="round" strokeDasharray="12 4" />
      <path d="M90 280 L180 280" stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
      <AutoRickshaw x={30} y={124} />
      <g stroke={INK} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="262" cy="150" r="10" fill={SKIN} strokeWidth={2} />
        <path d="M255 146 C256 140 268 140 270 146" fill={INK} strokeWidth={1.5} />
        <circle cx="259" cy="150" r="2.5" strokeWidth={1} />
        <circle cx="265" cy="150" r="2.5" strokeWidth={1} />
        <path d="M250 164 L274 164 L278 222 L246 222 Z" fill={MINT} strokeWidth={2.5} />
        <path d="M262 164 L262 222" strokeWidth={2} />
        <path d="M250 172 L236 200 L244 206" strokeWidth={2.5} />
        <path d="M274 172 L292 150" strokeWidth={2.5} />
        <rect x="288" y="130" width="14" height="22" rx="3" fill="#fff" strokeWidth={2} />
        <path d="M252 222 L248 268 M270 222 L274 268" strokeWidth={3} />
        <ellipse cx="246" cy="271" rx="7" ry="3" fill={INK} />
        <ellipse cx="276" cy="271" rx="7" ry="3" fill={INK} />
      </g>
    </svg>
  );
}

/** Newsroom thumbnail: itemised fare receipt. */
export function ReceiptArt({ className }: Svg) {
  return (
    <svg className={className} viewBox="0 0 160 100" fill="none" aria-hidden="true">
      <path d="M48 24 C58 24 64 16 64 16 C64 16 70 24 80 24 C80 40 68 52 64 56 C60 52 48 40 48 24 Z" fill={LIME} stroke={INK} strokeWidth={1.8} />
      <path d="M58 32 L62 38 L72 26" stroke={INK} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M92 14 L138 14 L138 84 L131 79 L124 84 L117 79 L110 84 L103 79 L96 84 L92 81 Z" fill="#fff" stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
      <g stroke={INK} strokeWidth={1.3} strokeLinecap="round">
        <line x1="99" y1="26" x2="118" y2="26" />
        <line x1="124" y1="26" x2="131" y2="26" />
        <line x1="99" y1="36" x2="114" y2="36" />
        <line x1="124" y1="36" x2="131" y2="36" />
        <line x1="99" y1="46" x2="116" y2="46" />
        <line x1="124" y1="46" x2="131" y2="46" />
        <line x1="99" y1="58" x2="131" y2="58" strokeDasharray="2 2" />
      </g>
      <rect x="99" y="63" width="32" height="8" rx="2" fill={LIME} stroke={INK} strokeWidth={1.2} />
      <line x1="10" y1="88" x2="150" y2="88" stroke={INK} strokeWidth={1.2} />
      <AutoRickshaw x={10} y={58} scale={0.2} withDriver={false} withRiders={false} />
    </svg>
  );
}

/** Newsroom thumbnail: a seat grid where the last seat is claimed exactly once. */
export function SeatGuaranteeArt({ className }: Svg) {
  return (
    <svg className={className} viewBox="0 0 160 100" fill="none" aria-hidden="true">
      <rect x="0" y="0" width="80" height="100" fill={LIME} />
      <rect x="80" y="0" width="80" height="100" fill="#F5EC47" />
      <text x="8" y="16" fontSize="8" fontWeight="900" fill={INK}>
        SEATS
      </text>
      <text x="8" y="26" fontSize="8" fontWeight="900" fill={INK}>
        3 / 3
      </text>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={12 + i * 20} y={46} width={16} height={22} rx={4} fill={i < 2 ? INK : '#fff'} stroke={INK} strokeWidth={1.6} />
      ))}
      <path d="M50 78 L54 83 L62 74" stroke={INK} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x={90} y={12 + i * 21} width={18} height={10} rx={2} fill={INK} />
          <text x={99} y={19.5 + i * 21} fontSize="6" fontWeight="700" fill="#fff" textAnchor="middle">
            {i === 0 ? '200' : '409'}
          </text>
          <circle cx={120} cy={17 + i * 21} r={5} fill={i === 0 ? LIME : '#fff'} stroke={INK} strokeWidth={1.2} />
        </g>
      ))}
    </svg>
  );
}
