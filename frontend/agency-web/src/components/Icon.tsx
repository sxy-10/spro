/**
 * 旅迹 · 统一图标组件
 *
 * 由 frontend/scripts/generate_icons.py 从 iconDefs.json 生成，请勿手改本文件。
 * 设计规格：24x24 网格 / 1.8px 描边 / 圆角端点 / currentColor 继承。
 */
import React from 'react';
import iconDefs from '../icons/iconDefs.json';

export type IconName = keyof typeof iconDefs;

interface ShapeDef {
  tag: 'path' | 'circle' | 'rect' | 'line' | 'polyline';
  attrs: Record<string, string | number>;
  filled?: boolean;
}

interface IconDefinition {
  label: string;
  group: string;
  description: string;
  shapes: ShapeDef[];
  accent: ShapeDef[];
}

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'name'> {
  /** 图标名，对应 iconDefs.json 的 key */
  name: IconName;
  /** 渲染尺寸，默认 20 */
  size?: number | string;
  /** 描边宽度，默认 1.8 */
  strokeWidth?: number;
  /** 是否显示强调细节（小圆点等），用于激活态 */
  active?: boolean;
  /** 无障碍标题；传入时移除 aria-hidden 并渲染 <title> */
  title?: string;
}

const definitions = iconDefs as unknown as Record<IconName, IconDefinition>;

export const ICON_NAMES = Object.keys(definitions) as IconName[];

function renderShape(shape: ShapeDef, key: string, asAccent: boolean) {
  const props: Record<string, string | number> = { ...shape.attrs, key };
  if (asAccent || shape.filled) {
    props.fill = 'currentColor';
    props.stroke = 'none';
  }
  return React.createElement(shape.tag, props);
}

/**
 * 通用图标：颜色继承父级 color，尺寸继承 size。
 *
 * @example
 * <Icon name="compass" size={22} />
 * <Icon name="star" active title="收藏" style={{ color: '#25582c' }} />
 */
export const Icon: React.FC<IconProps> = ({
  name,
  size = 20,
  strokeWidth = 1.8,
  active = false,
  title,
  ...rest
}) => {
  const definition = definitions[name];
  if (!definition) return null;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {definition.shapes.map((shape, index) => renderShape(shape, `line-${index}`, false))}
      {active
        ? definition.accent.map((shape, index) => renderShape(shape, `accent-${index}`, true))
        : null}
    </svg>
  );
};

export default Icon;
