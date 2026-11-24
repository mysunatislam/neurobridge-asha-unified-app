import { curveMonotoneX, line } from "d3-shape";

/**
 * Minimal line chart for live signals. Scales to its container width.
 * The path is drawn with d3-shape: a monotone curve passes through every
 * sample without overshooting, so a smoothed line never shows a peak or dip
 * the signal did not have.
 */
export function Sparkline({ values, height = 64, className }: { values: number[]; height?: number; className?: string }) {
  const pts = values.filter(Number.isFinite);
  if (pts.length < 2) return <div className={className} style={{ height }} />;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const d =
    line<number>()
      .x((_, i) => (i / (pts.length - 1)) * 100)
      .y((v) => height - 4 - ((v - min) / span) * (height - 8))
      .curve(curveMonotoneX)(pts) ?? "";
  return (
    <svg className={className} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height, width: "100%" }} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--color-brand)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
