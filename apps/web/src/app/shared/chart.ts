import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { ThemeService } from '../core/theme.service';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

/** daisyUI colour names; resolved from the active theme's `--color-*` variables at render time. */
export type ColorToken =
  'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'warning' | 'error' | 'neutral';

/** One bar or line series of a cartesian chart. */
export interface ChartSeries {
  name: string;
  type: 'bar' | 'line';
  /** One value per category, in the same order; `null` leaves a gap. */
  data: (number | null)[];
  color: ColorToken;
  /** Series with the same stack id are stacked. */
  stack?: string;
  /** Lines only: fill the area under the line with a faint tint. */
  area?: boolean;
}

/** One slice of a donut chart. */
export interface DonutSlice {
  name: string;
  value: number;
  color: ColorToken;
}

/** Declarative input for `<app-chart>`. */
export interface ChartSpec {
  /** X-axis labels. */
  categories: string[];
  series: ChartSeries[];
  /** When set, renders a donut instead of a cartesian chart (categories/series are ignored). */
  donut?: DonutSlice[];
  /** Suffix appended to y-axis labels and tooltip values (e.g. `" h"`, `"%"`). */
  unit?: string;
}

/**
 * ECharts can't parse `oklch()`; resolve theme CSS variables to rgb via a 1px canvas. Falls back to a fixed
 * indigo when the variable or a 2D context is missing.
 */
function resolveColor(token: string): string {
  const css = getComputedStyle(document.documentElement)
    .getPropertyValue(`--color-${token}`)
    .trim();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !css) return '#6366f1';
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

const withAlpha = (rgb: string, a: number) => rgb.replace('rgb(', 'rgba(').replace(')', `, ${a})`);

/**
 * Theme-aware ECharts wrapper driven by a small, declarative spec.
 *
 * @remarks
 * Inputs: `spec` (see {@link ChartSpec}), `height` in px and `label` as the accessible name. The chart is
 * created after first render, resizes with its container, and fully re-renders (no option merging)
 * whenever the spec or the theme changes, so colours always match the active theme.
 */
@Component({
  selector: 'app-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chart.html',
})
export class Chart implements OnDestroy {
  readonly spec = input.required<ChartSpec>();
  readonly height = input(260);
  readonly label = input('Chart');
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly theme = inject(ThemeService);
  private chart?: echarts.ECharts;
  private resize?: ResizeObserver;

  constructor() {
    afterNextRender(() => {
      this.chart = echarts.init(this.host().nativeElement, undefined, { renderer: 'canvas' });
      this.resize = new ResizeObserver(() => this.chart?.resize());
      this.resize.observe(this.host().nativeElement);
      this.render();
    });
    effect(() => {
      this.spec();
      this.theme.theme();
      // Wait a frame so a theme switch has applied its CSS variables.
      requestAnimationFrame(() => this.render());
    });
  }

  private render() {
    if (!this.chart) return;
    const spec = this.spec();
    const text = resolveColor('base-content');
    const grid = withAlpha(text, 0.08);
    const muted = withAlpha(text, 0.55);
    const unit = spec.unit ?? '';
    if (spec.donut) {
      this.chart.setOption(
        {
          textStyle: { fontFamily: 'Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif' },
          tooltip: {
            trigger: 'item',
            backgroundColor: resolveColor('base-100'),
            borderColor: withAlpha(text, 0.12),
            textStyle: { color: text },
            formatter: '{b}: {c} ({d}%)',
          },
          legend: {
            bottom: 0,
            icon: 'circle',
            itemWidth: 8,
            itemHeight: 8,
            textStyle: { color: muted },
          },
          series: [
            {
              type: 'pie',
              radius: ['58%', '82%'],
              center: ['50%', '44%'],
              padAngle: 3,
              itemStyle: { borderRadius: 8 },
              label: { show: false },
              data: spec.donut.map((d) => ({
                name: d.name,
                value: d.value,
                itemStyle: { color: resolveColor(d.color) },
              })),
            },
          ],
        },
        { notMerge: true },
      );
      return;
    }
    this.chart.setOption(
      {
        textStyle: { fontFamily: 'Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif' },
        grid: { left: 8, right: 12, top: 36, bottom: 8, containLabel: true },
        legend: {
          top: 0,
          left: 0,
          icon: 'roundRect',
          itemWidth: 10,
          itemHeight: 10,
          textStyle: { color: muted },
        },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow', shadowStyle: { color: withAlpha(text, 0.04) } },
          backgroundColor: resolveColor('base-100'),
          borderColor: withAlpha(text, 0.12),
          textStyle: { color: text },
          valueFormatter: (v: unknown) => (v === null || v === undefined ? '—' : `${v}${unit}`),
        },
        xAxis: {
          type: 'category',
          data: spec.categories,
          axisLine: { lineStyle: { color: grid } },
          axisTick: { show: false },
          axisLabel: { color: muted, hideOverlap: true },
        },
        yAxis: {
          type: 'value',
          minInterval: 1,
          splitLine: { lineStyle: { color: grid, type: 'dashed' } },
          axisLabel: { color: muted, formatter: `{value}${unit}` },
        },
        series: spec.series.map((s) => {
          const color = resolveColor(s.color);
          return {
            name: s.name,
            type: s.type,
            data: s.data,
            stack: s.stack,
            itemStyle: { color, borderRadius: s.type === 'bar' ? (s.stack ? 2 : [6, 6, 0, 0]) : 0 },
            lineStyle: { width: 3 },
            showSymbol: false,
            smooth: 0.3,
            smoothMonotone: 'x',
            barMaxWidth: 18,
            emphasis: { focus: 'series' },
            ...(s.area ? { areaStyle: { color: withAlpha(color, 0.12) } } : {}),
          };
        }),
      },
      { notMerge: true },
    );
  }

  ngOnDestroy() {
    this.resize?.disconnect();
    this.chart?.dispose();
  }
}
