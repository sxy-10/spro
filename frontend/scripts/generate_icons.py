#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
旅迹图标系统生成器

单一数据源：本文件里的 ICONS 定义。
产出：
  1. frontend/src/icons/iconDefs.json      React 组件消费的图标数据
  2. frontend/src/components/Icon.tsx      通用图标组件
  3. frontend/public/icons/*.svg           可独立使用的 SVG 素材
  4. frontend/public/favicon.svg           站点图标
  5. docs/design/图标系统预览.html          可视化预览与规范说明
  6. Android mipmap-* 桌面图标 PNG + vector 前景/背景 + colors.xml

设计约束：
  - 24x24 viewBox，2px 安全边距（内容控制在 3~21）
  - 1.8px 描边，round cap / round join
  - 颜色一律 currentColor，禁止硬编码
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
ICON_JSON = FRONTEND / "src" / "icons" / "iconDefs.json"
ICON_COMPONENT = FRONTEND / "src" / "components" / "Icon.tsx"
AGENCY_ICON_JSON = FRONTEND / "agency-web" / "src" / "icons" / "iconDefs.json"
AGENCY_ICON_COMPONENT = FRONTEND / "agency-web" / "src" / "components" / "Icon.tsx"
SVG_DIR = FRONTEND / "public" / "icons"
PUBLIC_DIR = FRONTEND / "public"
AGENCY_PUBLIC_DIR = FRONTEND / "agency-web" / "public"
PREVIEW_HTML = ROOT / "docs" / "design" / "图标系统预览.html"
ANDROID_RES = FRONTEND / "android" / "app" / "src" / "main" / "res"

BRAND = "#25582c"
BRAND_DARK = "#1a4421"
ACCENT = "#378044"
LIGHT = "#eaf5ed"

STROKE = 1.8


# ---------- 形状助手 ----------
def p(d: str) -> dict:
    return {"tag": "path", "attrs": {"d": d}}


def c(cx: float, cy: float, r: float) -> dict:
    return {"tag": "circle", "attrs": {"cx": cx, "cy": cy, "r": r}}


def rc(x: float, y: float, w: float, h: float, rx: float = 2) -> dict:
    return {"tag": "rect", "attrs": {"x": x, "y": y, "width": w, "height": h, "rx": rx, "ry": rx}}


def ln(x1: float, y1: float, x2: float, y2: float) -> dict:
    return {"tag": "line", "attrs": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}}


def pl(points: str) -> dict:
    return {"tag": "polyline", "attrs": {"points": points}}


def fc(cx: float, cy: float, r: float) -> dict:
    """实心圆点（用于「更多」等纯点状图标）。"""
    return {"tag": "circle", "attrs": {"cx": cx, "cy": cy, "r": r}, "filled": True}


def icon(name: str, label: str, group: str, shapes: list, accent: list | None = None) -> dict:
    return {
        "name": name,
        "label": label,
        "group": group,
        "description": f"{label} · {group}",
        "shapes": shapes,
        "accent": accent or [],
    }


ICONS: list[dict] = [
    # ---------------- 导航与业务主入口 ----------------
    icon("home", "计划", "导航", [
        p("M3.5 10.4 12 3.8l8.5 6.6v8.1a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z"),
        p("M9.4 20.2v-5.9h5.2v5.9"),
    ]),
    icon("calendar", "行程", "导航", [
        rc(3.2, 5.2, 17.6, 15.2, 3),
        ln(8, 3, 8, 7),
        ln(16, 3, 16, 7),
        ln(3.2, 10.2, 20.8, 10.2),
        ln(7.6, 14, 10.4, 14),
        ln(13.6, 14, 16.4, 14),
    ]),
    icon("sparkles", "智能体", "导航", [
        p("M12 3.2l1.7 4.9 4.9 1.7-4.9 1.7L12 16.4l-1.7-4.9L5.4 9.8l4.9-1.7z"),
        p("M18.4 15.1l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"),
        p("M5.2 14.5l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z"),
    ]),
    icon("compass", "探索", "导航", [
        c(12, 12, 8.8),
        p("M15.4 8.6l-2.2 5.2-5.2 2.2 2.2-5.2z"),
    ], [c(12, 12, 1.05)]),
    icon("user", "我的", "导航", [
        c(12, 8.2, 3.6),
        p("M4.8 20c.7-3.4 3.6-5.4 7.2-5.4s6.5 2 7.2 5.4"),
    ]),
    icon("message", "客服消息", "导航", [
        p("M19.8 12a7.3 7.3 0 0 1-7.3 7.3 8 8 0 0 1-2.5-.4L4.8 20.8l1.6-4.1a7 7 0 0 1-1.3-4.1 7.3 7.3 0 0 1 7.4-7.3 7.3 7.3 0 0 1 7.3 6.7z"),
        c(9, 12, 0.75),
        c(12.5, 12, 0.75),
        c(16, 12, 0.75),
    ]),
    icon("grid", "工作台", "导航", [
        rc(3.5, 3.5, 7, 7, 1.8),
        rc(13.5, 3.5, 7, 7, 1.8),
        rc(3.5, 13.5, 7, 7, 1.8),
        rc(13.5, 13.5, 7, 7, 1.8),
    ]),
    icon("chart", "数据看板", "导航", [
        ln(4, 4, 4, 20),
        ln(4, 20, 20, 20),
        ln(8, 16.5, 8, 12),
        ln(12.5, 16.5, 12.5, 7.5),
        ln(17, 16.5, 17, 10),
    ]),
    icon("map", "地图", "导航", [
        p("M3 6.5 8.5 4l7 2.5L21 4v13.5l-5.5 2.5-7-2.5L3 20z"),
        ln(8.5, 4, 8.5, 17.5),
        ln(15.5, 6.5, 15.5, 20),
    ]),
    icon("ticket", "订单票券", "导航", [
        p("M4 7.5h16v3a1.5 1.5 0 0 0 0 3v3H4v-3a1.5 1.5 0 0 0 0-3z"),
        ln(12, 8.5, 12, 10),
        ln(12, 11.5, 12, 13),
        ln(12, 14.5, 12, 16),
    ]),

    # ---------------- 通用操作 ----------------
    icon("search", "搜索", "操作", [
        c(10.8, 10.8, 6.2),
        ln(15.4, 15.4, 20, 20),
    ]),
    icon("plus", "新建", "操作", [
        ln(12, 5, 12, 19),
        ln(5, 12, 19, 12),
    ]),
    icon("close", "关闭", "操作", [
        ln(6.2, 6.2, 17.8, 17.8),
        ln(17.8, 6.2, 6.2, 17.8),
    ]),
    icon("check", "确认", "操作", [
        p("M4.8 12.4l5 5L19.4 7.2"),
    ]),
    icon("arrow-right", "进入", "操作", [
        ln(4, 12, 19, 12),
        p("M13.2 6.2 19 12l-5.8 5.8"),
    ]),
    icon("arrow-left", "返回", "操作", [
        ln(20, 12, 5, 12),
        p("M10.8 6.2 5 12l5.8 5.8"),
    ]),
    icon("chevron-down", "展开", "操作", [
        p("M6 9.2l6 6 6-6"),
    ]),
    icon("settings", "设置", "操作", [
        ln(4, 7.5, 12.5, 7.5),
        ln(18, 7.5, 20, 7.5),
        ln(4, 16.5, 6, 16.5),
        ln(11.5, 16.5, 20, 16.5),
        c(15.2, 7.5, 2.3),
        c(8.8, 16.5, 2.3),
    ]),
    icon("bell", "通知", "操作", [
        p("M18 16.5H6l1.4-2.2V10a4.6 4.6 0 0 1 9.2 0v4.3z"),
        p("M10 19a2 2 0 0 0 4 0"),
    ]),
    icon("logout", "退出登录", "操作", [
        p("M10 4.8H6.6A2.6 2.6 0 0 0 4 7.4v9.2a2.6 2.6 0 0 0 2.6 2.6H10"),
        p("M14 8l4 4-4 4"),
        ln(18, 12, 9, 12),
    ]),
    icon("edit", "编辑", "操作", [
        p("M4 20l4.2-.9L19.4 7.9a1.95 1.95 0 0 0-2.8-2.8L5.4 16.3z"),
        ln(15.8, 6.3, 18.7, 9.2),
    ]),
    icon("trash", "删除", "操作", [
        ln(4.5, 7, 19.5, 7),
        p("M9.5 7V4.8h5V7"),
        p("M6.6 7l.9 12.2a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5L17.4 7"),
        ln(10, 11, 10, 16.5),
        ln(14, 11, 14, 16.5),
    ]),
    icon("eye", "显示", "操作", [
        p("M2.6 12S6.1 6.6 12 6.6 21.4 12 21.4 12 17.9 17.4 12 17.4 2.6 12 2.6 12Z"),
        c(12, 12, 2.6),
    ]),
    icon("eye-off", "隐藏", "操作", [
        p("M2.6 12S6.1 6.6 12 6.6 21.4 12 21.4 12 17.9 17.4 12 17.4 2.6 12 2.6 12Z"),
        c(12, 12, 2.6),
        ln(4.2, 4.2, 19.8, 19.8),
    ]),
    icon("send", "发送", "操作", [
        ln(21, 3, 10.5, 13.5),
        p("M21 3l-6.8 18-3.7-7.5L3 9.8z"),
    ]),
    icon("mic", "语音", "操作", [
        rc(8.8, 3.5, 6.4, 11.2, 3.2),
        p("M5.8 11.5a6.2 6.2 0 0 0 12.4 0"),
        ln(12, 17.7, 12, 21),
    ]),
    icon("refresh", "刷新", "操作", [
        p("M20 11a8 8 0 1 0-2.3 6.2"),
        p("M20 5.5V11h-5.5"),
    ]),
    icon("download", "导出", "操作", [
        ln(12, 3.5, 12, 14.5),
        p("M8 10.8l4 4 4-4"),
        ln(4, 19.5, 20, 19.5),
    ]),
    icon("copy", "复制", "操作", [
        rc(8, 8, 11, 11, 2),
        p("M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"),
    ]),
    icon("filter", "筛选", "操作", [
        ln(4, 6.5, 20, 6.5),
        ln(7, 12, 17, 12),
        ln(10, 17.5, 14, 17.5),
    ]),
    icon("external", "外链", "操作", [
        ln(14, 4, 20, 4),
        ln(20, 4, 20, 10),
        ln(20, 4, 11, 13),
        p("M18 13.5v4.2a2.3 2.3 0 0 1-2.3 2.3H6.3A2.3 2.3 0 0 1 4 17.7V8.3A2.3 2.3 0 0 1 6.3 6h4.2"),
    ]),
    icon("more", "更多", "操作", [
        fc(5, 12, 1.25),
        fc(12, 12, 1.25),
        fc(19, 12, 1.25),
    ]),

    # ---------------- 业务语义 ----------------
    icon("star", "收藏", "业务", [
        p("M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"),
    ]),
    icon("shield", "行程判官", "业务", [
        p("M12 3l7.2 2.8v5.4c0 4.3-2.9 8.1-7.2 9.8-4.3-1.7-7.2-5.5-7.2-9.8V5.8z"),
        p("M9 12l2 2 4-4"),
    ]),
    icon("map-pin", "地点", "业务", [
        p("M12 21s6.5-6.4 6.5-11.3A6.5 6.5 0 0 0 5.5 9.7C5.5 14.6 12 21 12 21Z"),
        c(12, 9.7, 2.3),
    ]),
    icon("clock", "时间", "业务", [
        c(12, 12, 8.6),
        ln(12, 7.3, 12, 12.2),
        p("M12 12.2l3.2 2"),
    ]),
    icon("wallet", "钱包预算", "业务", [
        p("M4 8.5a2.5 2.5 0 0 1 2.5-2.5H18v3"),
        rc(4, 8.5, 16, 10.5, 2.5),
        ln(15.5, 14, 19, 14),
    ]),
    icon("box", "旅游产品", "业务", [
        p("M12 3l8 4.2v9.6L12 21l-8-4.2V7.2z"),
        p("M4 7.2l8 4.2 8-4.2"),
        ln(12, 11.4, 12, 21),
    ]),
    icon("team", "团队", "业务", [
        c(9, 8, 2.7),
        c(16.5, 9.2, 2.2),
        p("M3.5 19c.4-3 2.5-4.8 5.5-4.8s5.1 1.8 5.5 4.8"),
        p("M15 14.6c2.6-.4 4.7.9 5.3 3.6"),
    ]),
    icon("shop", "旅行社", "业务", [
        p("M4 10h16l-1.2-5.2H5.2z"),
        p("M5 10v9.5h14V10"),
        p("M4 10a2.5 2.5 0 0 0 4.5 1.5A2.5 2.5 0 0 0 12 10a2.5 2.5 0 0 0 3.5 1.5A2.5 2.5 0 0 0 20 10"),
    ]),
    icon("lock", "权限", "业务", [
        rc(5, 10.5, 14, 9, 2.4),
        p("M8 10.5V8a4 4 0 0 1 8 0v2.5"),
        c(12, 15, 1.05),
    ], [c(12, 15, 0.95)]),
    icon("route", "路线", "业务", [
        c(6, 18.3, 2.5),
        c(18, 5.7, 2.5),
        p("M8.3 16.2c2.7-.8 4.2-2.5 4.2-5.4 0-1.8.9-3 2.8-3.8"),
    ]),
    icon("flag", "目的地", "业务", [
        ln(5, 21, 5, 4),
        p("M5 5h11l-1.8 3.5L16 12H5"),
    ]),
    icon("backpack", "出行", "业务", [
        rc(5, 8, 14, 12, 3),
        p("M9 8V6.2a3 3 0 0 1 6 0V8"),
        p("M8.5 13h7v4.5h-7z"),
    ]),
    icon("plane", "航班", "业务", [
        p("M3.5 13.8l17-6.2-4.8 14.5-3.4-5.7-6.3-2.6z"),
        ln(9.8  , 16.4, 13.8, 19.2),
    ]),
    icon("mountain", "景点", "业务", [
        ln(3, 19.5, 21, 19.5),
        p("M6.5 19.5 12 8.2l3.2 5.6 1.8-3.1 4 8.8"),
    ]),
    icon("robot", "AI 助手", "业务", [
        rc(4, 7, 16, 11, 3),
        c(9, 12, 1.15),
        c(15, 12, 1.15),
        ln(12, 4, 12, 7),
        c(12, 3.6, 1),
    ], [c(9, 12, 0.9), c(15, 12, 0.9)]),
    icon("headset", "人工顾问", "业务", [
        p("M4 13v-1a8 8 0 0 1 16 0v1"),
        rc(3, 13, 3.5, 5, 1.6),
        rc(17.5, 13, 3.5, 5, 1.6),
        p("M20.5 18c0 1.7-1.9 2.8-4.6 2.8H12"),
    ]),
    icon("book", "百科", "业务", [
        p("M4.5 5.5A2.5 2.5 0 0 1 7 3h12v15H7a2.5 2.5 0 0 0-2.5 2.5z"),
        p("M4.5 20.5A2.5 2.5 0 0 1 7 18h12v3H7a2.5 2.5 0 0 1-2.5-2.5z"),
        ln(9, 7.5, 15, 7.5),
    ]),
    icon("flame", "秒杀", "业务", [
        p("M12 21c3.5 0 5.8-2.4 5.8-5.5 0-2.4-1.3-4.2-2.6-5.7-.3 1.6-1.2 2.5-2.1 2.8.5-3-1-5.8-3.4-8.4.2 2.8-1.1 4.6-2.3 6.1C6.3 12 6.2 13.7 6.2 15.5 6.2 18.6 8.5 21 12 21Z"),
        p("M12 21c1.6 0 2.7-1.1 2.7-2.6 0-1.3-.8-2.3-1.7-3.2-.3.9-.9 1.4-1.5 1.6.2-1.4-.5-2.7-1.5-3.9.1 1.5-.6 2.5-1.1 3.4-.4.7-.6 1.4-.6 2.1 0 1.5 1.1 2.6 2.7 2.6Z"),
    ]),
    icon("heart", "喜欢", "业务", [
        p("M12 20.3s-7.8-4.7-7.8-10A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.8 2.7c0 5.3-7.8 10-7.8 10Z"),
    ]),
    icon("info", "提示", "业务", [
        c(12, 12, 8.6),
        ln(12, 11, 12, 16.2),
    ], [c(12, 7.9, 1.05)]),
    icon("warning", "警告", "业务", [
        p("M12 3.8 21 19.4H3z"),
        ln(12, 9.5, 12, 14.2),
    ], [c(12, 17.1, 1.05)]),
    icon("check-circle", "成功", "业务", [
        c(12, 12, 8.6),
        p("M8 12.2l2.6 2.6L16.2 9.1"),
    ]),

    # ---------------- 天气 ----------------
    icon("sunny", "晴天", "天气", [
        c(12, 12, 4.1),
        ln(12, 2.6, 12, 5),
        ln(12, 19, 12, 21.4),
        ln(2.6, 12, 5, 12),
        ln(19, 12, 21.4, 12),
        ln(5.3, 5.3, 7, 7),
        ln(17, 17, 18.7, 18.7),
        ln(18.7, 5.3, 17, 7),
        ln(7, 17, 5.3, 18.7),
    ]),
    icon("cloudy", "多云", "天气", [
        c(8, 8, 3.1),
        p("M8.5 18.5h8.7a4 4 0 0 0 .3-8 5.7 5.7 0 0 0-10.7-1.1A4.6 4.6 0 0 0 8.5 18.5Z"),
    ]),
    icon("snowy", "雪天", "天气", [
        p("M8.3 15.8h7.4a3.6 3.6 0 0 0 0-7.2 5.2 5.2 0 0 0-9.8-.9 3.9 3.9 0 0 0 2.4 8.1Z"),
        ln(7.5, 18.8, 9.5, 18.8),
        ln(8.5, 17.8, 8.5, 19.8),
        ln(11.5, 21.2, 13.5, 21.2),
        ln(12.5, 20.2, 12.5, 22.2),
        ln(16, 18.8, 18, 18.8),
        ln(17, 17.8, 17, 19.8),
    ]),

    # ---------------- 自然装饰 ----------------
    icon("tree", "树木", "自然", [
        p("M12 3 6.8 10.5h3.1L5.5 17h13l-4.4-6.5h3.1z"),
        ln(12, 17, 12, 21),
    ]),
]


def attrs_to_str(attrs: dict) -> str:
    parts = []
    for key, value in attrs.items():
        if isinstance(value, float) and value.is_integer():
            value = int(value)
        parts.append(f'{key}="{value}"')
    return " ".join(parts)


def shapes_to_svg(shapes: list, *, stroke: bool = True, indent: str = "  ") -> str:
    lines = []
    for shape in shapes:
        filled = shape.get("filled", False) or not stroke
        common = ' fill="currentColor" stroke="none"' if filled else ' fill="none"'
        if shape["tag"] in ("circle", "path", "rect", "line", "polyline"):
            lines.append(f'{indent}<{shape["tag"]} {attrs_to_str(shape["attrs"])}{common} />')
    return "\n".join(lines)


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def generate_json() -> dict:
    data = {}
    for item in ICONS:
        data[item["name"]] = {
            "label": item["label"],
            "group": item["group"],
            "description": item["description"],
            "shapes": item["shapes"],
            "accent": item["accent"],
        }
    content = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    write_text(ICON_JSON, content)
    write_text(AGENCY_ICON_JSON, content)
    return data


def generate_component() -> None:
    source = '''/**
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
'''
    write_text(ICON_COMPONENT, source)
    write_text(AGENCY_ICON_COMPONENT, source)


def generate_svg_assets(data: dict) -> None:
    SVG_DIR.mkdir(parents=True, exist_ok=True)
    for name, definition in data.items():
        body = shapes_to_svg(definition["shapes"])
        accent = shapes_to_svg(definition["accent"], stroke=False)
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
            f'width="24" height="24" fill="none" stroke="currentColor" '
            f'stroke-width="{STROKE}" stroke-linecap="round" stroke-linejoin="round" '
            f'role="img" aria-label="{definition["label"]}">\n'
            f'  <title>{definition["label"]}</title>\n'
            f'{body}\n'
            f'{accent}\n'
            f'</svg>\n'
        )
        write_text(SVG_DIR / f"{name}.svg", svg)


def brand_favicon_svg() -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <title>旅行规划智能体</title>
  <rect x="2" y="2" width="60" height="60" rx="17" fill="{BRAND}"/>
  <path d="M12 45.5 26.5 24l9 13.2 5-7.2L52 45.5z" fill="none" stroke="#ffffff" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="44.5" cy="19" r="5.5" fill="{LIGHT}"/>
  <path d="M19 49c6-3.2 11-3.2 17 0" fill="none" stroke="{LIGHT}" stroke-width="3" stroke-linecap="round"/>
</svg>
'''


def generate_preview(data: dict) -> None:
    groups: dict[str, list] = {}
    for item in ICONS:
        groups.setdefault(item["group"], []).append(item)

    gallery_html = []
    for group, items in groups.items():
        cards = []
        for item in items:
            body = shapes_to_svg(item["shapes"])
            cards.append(f'''      <div class="icon-card" title="{item['name']}">
        <div class="icon-symbol">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{STROKE}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
{body}
          </svg>
        </div>
        <div class="icon-label">{item['label']}</div>
        <code>{item['name']}</code>
      </div>''')
        gallery_html.append(f'''    <section class="group">
      <h2><span class="group-dot"></span>{group}<span class="group-count">{len(items)}</span></h2>
      <div class="icon-grid">
{chr(10).join(cards)}
      </div>
    </section>''')

    size_demo = []
    for size in (16, 20, 24, 32, 48):
        size_demo.append(f'''      <div class="size-item">
        <svg viewBox="0 0 24 24" width="{size}" height="{size}" fill="none" stroke="currentColor" stroke-width="{STROKE}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
{shapes_to_svg(next(i for i in ICONS if i['name'] == 'compass')['shapes'])}
        </svg>
        <span>{size}px</span>
      </div>''')

    html = f'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>旅迹 · 统一图标系统 v1.0</title>
  <style>
    :root {{
      --brand: {BRAND};
      --brand-dark: {BRAND_DARK};
      --accent: {ACCENT};
      --brand-light: {LIGHT};
      --ink: #19211c;
      --ink-2: #58665e;
      --ink-3: #8c9b91;
      --line: #e8eee9;
      --bg: #f6f8f6;
      --card: #ffffff;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
      line-height: 1.6;
    }}
    .page {{ max-width: 1180px; margin: 0 auto; padding: 48px 32px 80px; }}
    header {{
      background: linear-gradient(135deg, var(--brand), var(--brand-dark));
      color: #fff;
      border-radius: 28px;
      padding: 44px 48px;
      position: relative;
      overflow: hidden;
      box-shadow: 0 18px 44px rgba(22, 60, 30, .18);
    }}
    header:after {{
      content: '';
      position: absolute;
      width: 300px; height: 300px;
      right: -90px; top: -130px;
      border: 1px solid rgba(255,255,255,.16);
      border-radius: 50%;
    }}
    .eyebrow {{ font-size: 12px; letter-spacing: .22em; opacity: .72; text-transform: uppercase; }}
    h1 {{ margin: 10px 0 6px; font-size: 38px; letter-spacing: -.02em; }}
    .subtitle {{ margin: 0; opacity: .82; font-size: 15px; }}
    .badges {{ display: flex; gap: 10px; margin-top: 26px; flex-wrap: wrap; }}
    .badge {{
      background: rgba(255,255,255,.13);
      border: 1px solid rgba(255,255,255,.22);
      border-radius: 999px;
      padding: 5px 13px;
      font-size: 12px;
    }}
    .section-title {{ font-size: 18px; margin: 46px 0 16px; display: flex; align-items: center; gap: 10px; }}
    .spec-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 14px; }}
    .spec-card {{
      background: var(--card); border: 1px solid var(--line); border-radius: 18px;
      padding: 20px 22px; box-shadow: 0 4px 16px rgba(22,60,30,.04);
    }}
    .spec-card h3 {{ margin: 0 0 8px; font-size: 14px; color: var(--brand); }}
    .spec-card p {{ margin: 0; font-size: 13px; color: var(--ink-2); }}
    .color-row {{ display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }}
    .swatch {{ display: flex; align-items: center; gap: 9px; font-size: 12px; color: var(--ink-2); }}
    .swatch i {{ width: 26px; height: 26px; border-radius: 9px; display: block; border: 1px solid rgba(0,0,0,.06); }}
    .size-row {{
      background: var(--card); border: 1px solid var(--line); border-radius: 18px;
      padding: 24px; display: flex; align-items: flex-end; gap: 36px; flex-wrap: wrap;
    }}
    .size-item {{ display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--brand); }}
    .size-item span {{ font-size: 11px; color: var(--ink-3); }}
    .group {{ margin-top: 40px; }}
    .group h2 {{ font-size: 15px; margin: 0 0 16px; display: flex; align-items: center; gap: 9px; color: var(--ink); }}
    .group-dot {{ width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }}
    .group-count {{ font-size: 11px; color: var(--ink-3); font-weight: 400; }}
    .icon-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(146px, 1fr)); gap: 12px; }}
    .icon-card {{
      background: var(--card); border: 1px solid var(--line); border-radius: 16px;
      padding: 20px 10px 14px; text-align: center; transition: .18s ease;
    }}
    .icon-card:hover {{
      border-color: var(--accent);
      transform: translateY(-3px);
      box-shadow: 0 10px 24px rgba(22,60,30,.09);
    }}
    .icon-symbol {{ height: 34px; display: flex; align-items: center; justify-content: center; color: var(--brand); }}
    .icon-symbol svg {{ width: 26px; height: 26px; }}
    .icon-label {{ font-size: 13px; margin-top: 12px; font-weight: 600; }}
    .icon-card code {{ font-size: 10px; color: var(--ink-3); }}
    pre {{
      background: #18251c; color: #dce8df; border-radius: 16px; padding: 20px 22px;
      overflow: auto; font-size: 12.5px; line-height: 1.7;
    }}
    .demo-bar {{
      background: #fff; border: 1px solid var(--line); border-radius: 18px;
      padding: 18px; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;
    }}
    .demo-tab {{
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      min-width: 76px; padding: 10px 8px; border-radius: 14px;
      color: var(--ink-3); font-size: 11px;
    }}
    .demo-tab.active {{ background: var(--brand-light); color: var(--brand); font-weight: 700; }}
    footer {{ margin-top: 50px; text-align: center; color: var(--ink-3); font-size: 12px; }}
  </style>
</head>
<body>
  <div class="page">
    <header>
      <div class="eyebrow">Travel Icon System · v1.0</div>
      <h1>旅迹 · 统一图标系统</h1>
      <p class="subtitle">为旅行规划智能体设计的线性图标族 —— 克制、清晰、带一点户外的呼吸感。</p>
      <div class="badges">
        <span class="badge">{len(ICONS)} 枚图标</span>
        <span class="badge">24 × 24 网格</span>
        <span class="badge">1.8px 描边</span>
        <span class="badge">currentColor 继承</span>
        <span class="badge">React + 独立 SVG 双交付</span>
      </div>
    </header>

    <h2 class="section-title">设计规范</h2>
    <div class="spec-grid">
      <div class="spec-card">
        <h3>网格与留白</h3>
        <p>所有图形锁定 24 × 24 视图框，主体控制在 3 ~ 21 的安全区内，保证 16px 小尺寸依然清晰。</p>
      </div>
      <div class="spec-card">
        <h3>描边语言</h3>
        <p>统一 1.8px 描边、圆头圆角连接；不使用实心色块，靠几何轮廓建立轻盈统一的视觉节奏。</p>
      </div>
      <div class="spec-card">
        <h3>颜色策略</h3>
        <p>全部使用 currentColor，跟随文字颜色；激活态通过父级 color 与可选 accent 细节表达，不写死色值。</p>
        <div class="color-row">
          <div class="swatch"><i style="background:{BRAND}"></i>品牌绿 {BRAND}</div>
          <div class="swatch"><i style="background:{ACCENT}"></i>强调绿 {ACCENT}</div>
          <div class="swatch"><i style="background:{LIGHT}"></i>浅绿底 {LIGHT}</div>
        </div>
      </div>
      <div class="spec-card">
        <h3>语义准确性</h3>
        <p>同一语义只保留一个图形：收藏统一星形、判官统一盾牌、AI 统一星芒、客服统一气泡与耳机。</p>
      </div>
    </div>

    <h2 class="section-title">尺寸适配</h2>
    <div class="size-row">
{chr(10).join(size_demo)}
    </div>

    <h2 class="section-title">底部导航效果预览</h2>
    <div class="demo-bar">
      <div class="demo-tab active">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="{STROKE}" stroke-linecap="round" stroke-linejoin="round">{shapes_to_svg(next(i for i in ICONS if i['name'] == 'home')['shapes'])}</svg>
        计划
      </div>
      <div class="demo-tab">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="{STROKE}" stroke-linecap="round" stroke-linejoin="round">{shapes_to_svg(next(i for i in ICONS if i['name'] == 'calendar')['shapes'])}</svg>
        行程
      </div>
      <div class="demo-tab">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="{STROKE}" stroke-linecap="round" stroke-linejoin="round">{shapes_to_svg(next(i for i in ICONS if i['name'] == 'sparkles')['shapes'])}</svg>
        智能体
      </div>
      <div class="demo-tab">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="{STROKE}" stroke-linecap="round" stroke-linejoin="round">{shapes_to_svg(next(i for i in ICONS if i['name'] == 'compass')['shapes'])}</svg>
        探索
      </div>
      <div class="demo-tab">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="{STROKE}" stroke-linecap="round" stroke-linejoin="round">{shapes_to_svg(next(i for i in ICONS if i['name'] == 'user')['shapes'])}</svg>
        我的
      </div>
    </div>

    <h2 class="section-title">图标总览</h2>
{chr(10).join(gallery_html)}

    <h2 class="section-title">使用方式</h2>
    <pre><code>// 1. React 组件（推荐：颜色随父级 color 继承）
import {{ Icon }} from './components/Icon';

&lt;Icon name="compass" size={22} /&gt;
&lt;Icon name="star" active title="收藏" style={{ color: '#25582c' }} /&gt;

// 2. 独立 SVG 素材
&lt;img src="/icons/compass.svg" width="24" height="24" alt="探索" /&gt;

// 3. 颜色控制
.icon-host {{ color: var(--theme-brand-green); }}  /* 图标自动继承 */</code></pre>

    <footer>旅迹图标系统 · 由 frontend/scripts/generate_icons.py 生成 · 修改图标请改脚本中的 ICONS 定义后重新生成</footer>
  </div>
</body>
</html>
'''
    write_text(PREVIEW_HTML, html)


def generate_favicon() -> None:
    content = brand_favicon_svg()
    write_text(PUBLIC_DIR / "favicon.svg", content)
    write_text(AGENCY_PUBLIC_DIR / "favicon.svg", content)


def generate_android() -> None:
    """生成 Android 桌面图标：PNG（各密度）+ adaptive 前景 vector + 品牌色。"""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print("[skip] PIL 未安装，跳过 Android 图标生成")
        return

    densities = {
        "mdpi": 48,
        "hdpi": 72,
        "xhdpi": 96,
        "xxhdpi": 144,
        "xxxhdpi": 192,
    }

    def draw_mark(draw: ImageDraw.ImageDraw, box: tuple[float, float, float, float], fill: str) -> None:
        """在 box 内绘制山峦 + 路径 + 太阳标记。"""
        x0, y0, x1, y1 = box
        w = x1 - x0
        h = y1 - y0
        s = min(w, h)

        def pt(x: float, y: float) -> tuple[float, float]:
            return (x0 + x / 64 * s, y0 + y / 64 * s)

        lw = max(2, int(round(4.2 / 64 * s)))
        # 山峦轮廓
        points = [pt(11, 45), pt(26, 23), pt(35, 36), pt(40, 29), pt(52, 45)]
        draw.line(points, fill=fill, width=lw, joint="curve")
        # 山脚步道
        path_pts = [pt(18, 49), pt(25, 46), pt(33, 46), pt(40, 49)]
        draw.line(path_pts, fill=fill, width=max(2, int(round(2.6 / 64 * s))), joint="curve")
        # 太阳
        cx, cy = pt(45, 18)
        r = 5.4 / 64 * s
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=fill)
        # 圆头
        for px, py in points[1:-1]:
            draw.ellipse((px - lw / 2, py - lw / 2, px + lw / 2, py + lw / 2), fill=fill)

    for density, base in densities.items():
        target = ANDROID_RES / f"mipmap-{density}"
        target.mkdir(parents=True, exist_ok=True)
        scale = 4
        size = base * scale

        # 方形图标
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * 0.22), fill=BRAND)
        pad = size * 0.13
        draw_mark(d, (pad, pad, size - pad, size - pad), "#ffffff")
        img.resize((base, base), Image.Resampling.LANCZOS).save(target / "ic_launcher.png")

        # 圆形图标
        img_round = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img_round)
        d.ellipse((0, 0, size - 1, size - 1), fill=BRAND)
        pad = size * 0.17
        draw_mark(d, (pad, pad, size - pad, size - pad), "#ffffff")
        img_round.resize((base, base), Image.Resampling.LANCZOS).save(target / "ic_launcher_round.png")

        # Adaptive 前景：透明底，图形落在中间 66/108 安全区
        fg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(fg)
        pad = size * 0.25
        draw_mark(d, (pad, pad, size - pad, size - pad), "#ffffff")
        fg.resize((base, base), Image.Resampling.LANCZOS).save(target / "ic_launcher_foreground.png")

    # adaptive 背景色与主题色
    write_text(
        ANDROID_RES / "values" / "ic_launcher_background.xml",
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<resources>\n'
        f'    <color name="ic_launcher_background">{BRAND}</color>\n'
        '</resources>\n',
    )
    write_text(
        ANDROID_RES / "values" / "colors.xml",
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<resources>\n'
        f'    <color name="colorPrimary">{BRAND}</color>\n'
        f'    <color name="colorPrimaryDark">{BRAND_DARK}</color>\n'
        f'    <color name="colorAccent">{ACCENT}</color>\n'
        '</resources>\n',
    )

    # 用矢量前景替换 Capacitor 默认机器人
    vector = f'''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <!-- 山峦 -->
    <path
        android:pathData="M27,63 L42,35 L51,49 L57,41 L77,63"
        android:fillColor="#00000000"
        android:strokeColor="#FFFFFF"
        android:strokeWidth="5.6"
        android:strokeLineCap="round"
        android:strokeLineJoin="round" />
    <!-- 山脚步道 -->
    <path
        android:pathData="M34,70 C42,65 50,65 59,70"
        android:fillColor="#00000000"
        android:strokeColor="{LIGHT}"
        android:strokeWidth="3.4"
        android:strokeLineCap="round" />
    <!-- 太阳 -->
    <path
        android:pathData="M68.5,29.5 a5.5,5.5 0 1,0 0.1,0"
        android:fillColor="{LIGHT}" />
</vector>
'''
    write_text(ANDROID_RES / "drawable" / "ic_launcher_foreground.xml", vector)
    v24 = ANDROID_RES / "drawable-v24"
    if v24.exists():
        write_text(v24 / "ic_launcher_foreground.xml", vector)


def generate_splash() -> None:
    """替换 Capacitor 默认启动图为品牌启动图。"""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print("[skip] PIL 未安装，跳过启动图生成")
        return

    splash_sizes = {
        "drawable": (480, 320),
        "drawable-mdpi": (320, 480),
        "drawable-land-mdpi": (480, 320),
        "drawable-land-hdpi": (800, 480),
        "drawable-land-xhdpi": (1280, 720),
        "drawable-land-xxhdpi": (1600, 960),
        "drawable-land-xxxhdpi": (1920, 1280),
        "drawable-port-hdpi": (480, 800),
        "drawable-port-xhdpi": (720, 1280),
        "drawable-port-xxhdpi": (960, 1600),
        "drawable-port-xxxhdpi": (1280, 1920),
    }

    def mark(draw: ImageDraw.ImageDraw, box: tuple[float, float, float, float], fill: str) -> None:
        x0, y0, x1, y1 = box
        s = min(x1 - x0, y1 - y0)

        def pt(x: float, y: float) -> tuple[float, float]:
            return (x0 + x / 64 * s, y0 + y / 64 * s)

        lw = max(2, int(round(4.2 / 64 * s)))
        points = [pt(11, 45), pt(26, 23), pt(35, 36), pt(40, 29), pt(52, 45)]
        draw.line(points, fill=fill, width=lw, joint="curve")
        draw.line([pt(18, 49), pt(25, 46), pt(33, 46), pt(40, 49)],
                  fill=fill, width=max(2, int(round(2.6 / 64 * s))), joint="curve")
        cx, cy = pt(45, 18)
        r = 5.4 / 64 * s
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=fill)
        for px, py in points[1:-1]:
            draw.ellipse((px - lw / 2, py - lw / 2, px + lw / 2, py + lw / 2), fill=fill)

    for folder, (w, h) in splash_sizes.items():
        target_dir = ANDROID_RES / folder
        target_dir.mkdir(parents=True, exist_ok=True)
        scale = 2
        img = Image.new("RGB", (w * scale, h * scale), "#f8faf9")
        d = ImageDraw.Draw(img)
        cx, cy = w * scale / 2, h * scale / 2
        radius = min(min(w, h) * 0.17, 120) * scale
        d.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=LIGHT)
        side = min(min(w, h) * 0.3, 180) * scale
        mark(d, (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2), BRAND)
        img.resize((w, h), Image.Resampling.LANCZOS).save(target_dir / "splash.png", optimize=True)


def main() -> None:
    data = generate_json()
    generate_component()
    generate_svg_assets(data)
    generate_favicon()
    generate_preview(data)
    generate_android()
    generate_splash()
    print(f"[ok] {len(ICONS)} icons generated")
    print(f"[ok] JSON      -> {ICON_JSON}")
    print(f"[ok] Component -> {ICON_COMPONENT}")
    print(f"[ok] SVG       -> {SVG_DIR}")
    print(f"[ok] Preview   -> {PREVIEW_HTML}")
    print(f"[ok] Favicon   -> {PUBLIC_DIR / 'favicon.svg'}")


if __name__ == "__main__":
    main()
