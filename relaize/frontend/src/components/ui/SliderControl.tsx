import * as Slider from "@radix-ui/react-slider";

type SliderControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  formatValue?: (value: number) => string;
  description?: string;
  onValueChange: (value: number) => void;
  disabled?: boolean;
};

export const SliderControl = ({
  label,
  value,
  min,
  max,
  step = 1,
  formatValue = (v) => `${v}%`,
  description,
  onValueChange,
  disabled = false,
}: SliderControlProps) => (
  <div
    className={`space-y-3 rounded-2xl bg-white/80 p-4 shadow-card ${
      disabled ? "opacity-60" : ""
    }`}
  >
    <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
      <span>{label}</span>
      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-600">
        {formatValue(value)}
      </span>
    </div>
    <Slider.Root
      className="relative flex h-5 w-full items-center"
      min={min}
      max={max}
      step={step}
      value={[value]}
      onValueChange={([val]) => onValueChange(val)}
      disabled={disabled}
    >
      <Slider.Track className="relative h-1.5 w-full rounded-full bg-slate-200">
        <Slider.Range className="absolute h-full rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary" />
      </Slider.Track>
      <Slider.Thumb className="block h-4 w-4 rounded-full border-2 border-white bg-brand-secondary shadow" />
    </Slider.Root>
    <p className="text-xs text-slate-500">
      {description ?? ""}
      {disabled ? " · 切换到“自定义”即可调整" : ""}
    </p>
  </div>
);
