declare const __GAME_ASSET_VERSION__: string;

/** Select images from this build even when a previous release is cached by the browser. */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}?v=${__GAME_ASSET_VERSION__}`;
}
