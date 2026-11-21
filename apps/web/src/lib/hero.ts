// When the landing hero shows the WebGL glass controller. On phones the controller sat on top of
// "+ 3 AI agents" and the intro text, so phones keep the HTML headline (the 3D scroll runway is
// desktop-only anyway: md:h-[170vh]).
export const HERO_3D_QUERY = '(min-width: 768px)';

export const heroUses3d = (o: { webgl2: boolean; wide: boolean }): boolean => o.webgl2 && o.wide;
