// Draws the local model reply times on the /ai page as a static SVG, from the committed eval
// summary. The chart is a Vega-Lite spec compiled and rendered here in Node, so the page ships an
// image and no chart code.
//
//   node scripts/local-llm-chart.mjs            # writes public/charts/local-llm-reply-times.svg
//   node scripts/local-llm-chart.mjs --check    # exits 1 if the committed SVG is out of date
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as vega from "vega";
import * as vl from "vega-lite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SUMMARY_PATH = join(root, "docs/local-llm-eval-summary.json");
export const SVG_PATH = join(root, "public/charts/local-llm-reply-times.svg");
// Same order as the table on /ai: best first.
export const ORDER = ["qwen2.5:1.5b", "gemma2:2b", "llama3.2:1b", "deepseek-r1:1.5b"];

const s = (ms) => Math.round(ms / 100) / 10;

export function chartSpec(summary) {
  const values = ORDER.map((model) => summary.models.find((m) => m.model === model))
    .filter(Boolean)
    .map((m) => ({ model: m.model, median: s(m.medianMs), p95: s(m.p95Ms), label: `${s(m.medianMs)} s · ${s(m.p95Ms)} s` }));
  const top = Math.ceil((Math.max(...values.map((v) => v.p95)) + 8) / 10) * 10;
  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    width: 520,
    height: { step: 34 },
    padding: { left: 4, right: 8, top: 4, bottom: 4 },
    background: "#ffffff",
    data: { values },
    encoding: {
      y: { field: "model", type: "nominal", sort: ORDER, title: null, axis: { labelFont: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", labelFontSize: 12, labelColor: "#172b4d", domain: false, ticks: false, labelPadding: 10 } },
    },
    layer: [
      {
        mark: { type: "rule", strokeWidth: 3, color: "#bfd3fb", strokeCap: "round" },
        encoding: {
          x: { field: "median", type: "quantitative", title: "Seconds per reply on the laptop CPU", scale: { domain: [0, top], nice: false }, axis: { values: Array.from({ length: top / 10 + 1 }, (_, i) => i * 10), grid: true } },
          x2: { field: "p95" },
        },
      },
      { mark: { type: "point", filled: true, size: 80, color: "#2563eb", opacity: 1 }, encoding: { x: { field: "median", type: "quantitative" } } },
      { mark: { type: "tick", thickness: 2, size: 14, color: "#15345b" }, encoding: { x: { field: "p95", type: "quantitative" } } },
      { mark: { type: "text", align: "left", dx: 9, fontSize: 11, color: "#64748b" }, encoding: { x: { field: "p95", type: "quantitative" }, text: { field: "label" } } },
    ],
    config: {
      font: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      view: { stroke: null },
      axis: { labelColor: "#64748b", titleColor: "#64748b", titleFontWeight: 500, titleFontSize: 12, labelFontSize: 11, gridColor: "#dbe5f0", domainColor: "#dbe5f0", tickColor: "#dbe5f0" },
    },
  };
}

export async function renderSvg(summary) {
  const view = new vega.View(vega.parse(vl.compile(chartSpec(summary)).spec), { renderer: "none" });
  try {
    const svg = await view.toSVG();
    return svg.endsWith("\n") ? svg : `${svg}\n`;
  } finally {
    view.finalize();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const svg = await renderSvg(JSON.parse(readFileSync(SUMMARY_PATH, "utf8")));
  if (process.argv.includes("--check")) {
    const current = readFileSync(SVG_PATH, "utf8");
    if (current !== svg) {
      console.error("public/charts/local-llm-reply-times.svg is out of date: run node scripts/local-llm-chart.mjs");
      process.exit(1);
    }
    console.log("Chart is up to date.");
  } else {
    mkdirSync(dirname(SVG_PATH), { recursive: true });
    writeFileSync(SVG_PATH, svg);
    console.log(`Wrote ${SVG_PATH} (${svg.length} bytes)`);
  }
}
