/**
 * 轻量 SVG 图表（零依赖）：
 *   LineChart  折线面积图（经营趋势占位/演示）
 *   BarList    水平条形榜单（热门目的地）
 * 数据仅作展示，不参与任何业务计算。
 */
export function LineChart({ points, height = 180 }: { points: { label: string; value: number }[]; height?: number }) {
  const width = 560;
  const pad = { top: 16, right: 12, bottom: 26, left: 40 };
  const values = points.map((point) => point.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const spanX = width - pad.left - pad.right;
  const spanY = height - pad.top - pad.bottom;
  const scaleY = (value: number) => pad.top + spanY - ((value - min) / Math.max(max - min, 1)) * spanY;
  const stepX = points.length > 1 ? spanX / (points.length - 1) : spanX;
  const coords = points.map((point, index) => ({ x: pad.left + index * stepX, y: scaleY(point.value), ...point }));
  const line = coords.map((c, index) => `${index === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1]?.x ?? pad.left},${height - pad.bottom} L${pad.left},${height - pad.bottom} Z`;
  const gridValues = [max, (max + min) / 2, min];

  return (
    <svg className="chart-line" viewBox={`0 0 ${width} ${height}`} role="img">
      {gridValues.map((value) => (
        <g key={value}>
          <line x1={pad.left} x2={width - pad.right} y1={scaleY(value)} y2={scaleY(value)} stroke="#e6ebe8" strokeDasharray="3 4" />
          <text x={pad.left - 6} y={scaleY(value) + 4} fontSize="10" fill="#98a6a0" textAnchor="end">{Math.round(value)}</text>
        </g>
      ))}
      <path d={area} fill="rgba(34,197,94,0.12)" />
      <path d={line} fill="none" stroke="#16a34a" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      {coords.map((c) => (
        <g key={c.label}>
          <circle cx={c.x} cy={c.y} r="3.4" fill="#fff" stroke="#16a34a" strokeWidth="2">
            <title>{`${c.label}：${c.value}`}</title>
          </circle>
          <text x={c.x} y={height - 8} fontSize="10" fill="#98a6a0" textAnchor="middle">{c.label}</text>
        </g>
      ))}
    </svg>
  );
}

export function BarList({ items }: { items: { label: string; value: number; hint?: string }[] }) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="bar-list">
      {items.map((item) => (
        <div key={item.label} className="bar-row">
          <span className="name" title={item.label}>{item.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.max(6, (item.value / max) * 100)}%` }} />
          </span>
          <span className="val">{item.hint ?? item.value}</span>
        </div>
      ))}
    </div>
  );
}
