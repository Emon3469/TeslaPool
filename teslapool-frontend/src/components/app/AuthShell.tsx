import { AutoRickshaw } from '@/components/illustrations';

export function AuthShell({ title, highlight, subtitle, children }: { title: string; highlight: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="container-page py-10 md:py-16">
      <div className="mx-auto grid max-w-5xl overflow-hidden rounded-4xl border-subtle bg-white shadow-card lg:grid-cols-2">
        <div className="on-lime relative hidden flex-col justify-between bg-brand p-10 lg:flex">
          <div>
            <h1 className="text-4xl font-black leading-tight tracking-tight">
              {title}
              <br />
              <span className="rounded-md bg-dark px-2 text-brand">{highlight}</span>
            </h1>
            <p className="mt-4 max-w-sm text-sm font-medium leading-relaxed text-dark/75">{subtitle}</p>
          </div>
          <svg viewBox="0 0 300 175" className="mt-10 w-full" aria-hidden="true">
            <line x1="0" y1="160" x2="300" y2="160" stroke="#151515" strokeWidth="2" />
            <g transform="translate(44 12)">
              <rect x="-6" y="-2" width="224" height="152" rx="18" fill="#FFFEE9" opacity="0.55" />
            </g>
            <AutoRickshaw x={44} y={13} />
          </svg>
        </div>
        <div className="p-6 sm:p-10">{children}</div>
      </div>
    </section>
  );
}
