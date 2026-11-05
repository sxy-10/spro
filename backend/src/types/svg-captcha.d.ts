/**
 * 组员4 补丁：svg-captcha 没有官方类型定义，这里手写一个最小声明，
 * 比装 @types/svg-captcha 更稳（那个包维护滞后，且会与运行时版本错位）。
 */
declare module 'svg-captcha' {
  export interface CaptchaOptions {
    size?: number;
    noise?: number;
    color?: boolean;
    background?: string;
    ignoreChars?: string;
    width?: number;
    height?: number;
    fontSize?: number;
    charPreset?: string;
  }
  export interface CaptchaObject {
    /** SVG 字符串 */
    data: string;
    /** 图片上的文字 */
    text: string;
  }
  export function create(options?: CaptchaOptions): CaptchaObject;
  export function createMathExpr(options?: CaptchaOptions): CaptchaObject;
}
