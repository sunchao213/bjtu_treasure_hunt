/**
 * 局内提示层级。
 * 校园前景（南门、石柱、旗杆）按脚底做前后遮挡。
 * 搜索圈和危险文字画在这些素材和夜色遮罩之上，避免被建筑或黑暗盖住。
 */

export const ENTITY_DEPTH_BASE = 100;
export const NIGHT_MASK_DEPTH = 4000;
/** 南门牌坊脚底。前景只遮住站在门洞里的人，不再压过整张地图。 */
export const SOUTH_GATE_FEET_Y = 1768;
export const PLAY_ALERT_DEPTH = 4200;

export function alertClearsArt(artDepth: number): boolean {
  return PLAY_ALERT_DEPTH > artDepth;
}
