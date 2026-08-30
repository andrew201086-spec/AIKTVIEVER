import type { ReactNode } from 'react';

export const Panel = ({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) => (
  <section className="border-b border-slate-800">
    <header className="flex items-center justify-between px-3 py-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {title}
      </h3>
      {actions}
    </header>
    <div className="px-3 pb-3">{children}</div>
  </section>
);

export const ToolButton = ({
  active,
  disabled,
  onClick,
  title,
  children,
  tone = 'default',
}: {
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  children: ReactNode;
  tone?: 'default' | 'danger' | 'accent';
}) => {
  const base =
    'inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40';
  const tones = {
    default: active
      ? 'bg-sky-600 text-white'
      : 'bg-slate-800 text-slate-200 hover:bg-slate-700',
    accent: active
      ? 'bg-emerald-600 text-white'
      : 'bg-emerald-700/70 text-emerald-50 hover:bg-emerald-600',
    danger: 'bg-red-700/80 text-red-50 hover:bg-red-600',
  };
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${tones[tone]}`}
    >
      {children}
    </button>
  );
};

export const Field = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <label className="block">
    <span className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">
      {label}
    </span>
    {children}
  </label>
);

export const inputClass =
  'w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500';

export const Slider = ({
  value,
  min,
  max,
  step = 0.1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) => (
  <input
    type="range"
    className="h-1 w-full cursor-pointer appearance-none rounded bg-slate-700 accent-sky-500"
    value={value}
    min={min}
    max={max}
    step={step}
    onChange={(event) => onChange(Number(event.target.value))}
  />
);
