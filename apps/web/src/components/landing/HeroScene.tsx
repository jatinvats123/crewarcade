'use client';

import { Environment, Lightformer, Text } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { MathUtils, type Group } from 'three';
import { GlassController } from './GlassController';

/**
 * The landing hero in WebGL: the giant headline and, in front of it, a glass game controller whose
 * face buttons glow in the agent colours. The glass refracts the real headline behind it.
 * GlassHero shows an HTML headline instead without WebGL2 and until the font has loaded.
 */
export type HeroSceneProps = {
  /** 0 at the top of the hero, 1 when its scroll runway is used up. */
  progress: RefObject<number>;
  /** prefers-reduced-motion: one still frame, no idle, pointer or scroll motion. */
  still: boolean;
  /** false while the hero is off screen: stop rendering frames. */
  active: boolean;
  /** Called once the headline is laid out, so the HTML fallback can hide. */
  onReady: () => void;
  /** 'low' on small screens: fewer glass samples and segments. */
  quality: 'high' | 'low';
};

// Colours are inlined here because WebGL can't read CSS variables (values match globals.css).
const INK = '#f4f4ef';
const LIME = '#c5f82a';
const BG = '#0a0a0a';
const FONT = '/fonts/anton-latin-400.woff';

export default function HeroScene({ progress, still, active, onReady, quality }: HeroSceneProps) {
  return (
    <Canvas
      className="!absolute inset-0"
      dpr={quality === 'high' ? [1, 1.75] : 1}
      camera={{ position: [0, 0, 10], fov: 30 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      frameloop={still || !active ? 'demand' : 'always'}
      aria-hidden
    >
      <color attach="background" args={[BG]} />
      <Headline progress={progress} still={still} onReady={onReady} />
      <Controller progress={progress} still={still} quality={quality} />
      {/* A studio built from light panels (no HDR download): white softboxes and one lime ring. */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={5} position={[0, 5, 2]} rotation-x={Math.PI / 2} scale={[10, 2, 1]} />
        <Lightformer form="rect" intensity={5} position={[-5, 0, 1]} rotation-y={Math.PI / 2} scale={[2, 8, 1]} />
        <Lightformer form="rect" intensity={5} position={[5, 0, 1]} rotation-y={-Math.PI / 2} scale={[2, 8, 1]} />
        {/* Two thin lime strips below: a hint of green on the lower edges, as in the reference. */}
        <Lightformer form="rect" color={LIME} intensity={1.2} position={[-3, -5, 0]} rotation-x={-Math.PI / 2} scale={[3, 0.4, 1]} />
        <Lightformer form="rect" color={LIME} intensity={1.2} position={[3, -5, 0]} rotation-x={-Math.PI / 2} scale={[3, 0.4, 1]} />
        <Lightformer form="ring" color={LIME} intensity={3} position={[3, 2, -4]} scale={3} />
        <Lightformer form="rect" intensity={1.5} position={[0, 0, 6]} scale={[4, 4, 1]} />
        {/* Soft panel low in front: the glossy highlight across the face. */}
        <Lightformer form="rect" intensity={1.4} position={[0, -4, 5]} rotation-x={-Math.PI / 3} scale={[10, 4, 1]} />
      </Environment>
    </Canvas>
  );
}

type TroikaText = { textRenderInfo?: { blockBounds?: ArrayLike<number> } };

function Headline({ progress, still, onReady }: { progress: RefObject<number>; still: boolean; onReady: () => void }) {
  const group = useRef<Group>(null);
  const fitScale = useRef(1);
  const bounds = useRef<{ w: number; h: number } | null>(null);
  const camera = useThree(s => s.camera);
  const viewport = useThree(s => s.viewport);
  const z = -1.5;
  const vp = viewport.getCurrentViewport(camera, [0, 0, z]);

  // Fill ~80% of the width, but never more than ~42% of the height (wide, short windows).
  const fit = useCallback(() => {
    const b = bounds.current;
    const g = group.current;
    if (!b || !g) return;
    fitScale.current = Math.min((vp.width * 0.8) / b.w, (vp.height * 0.42) / b.h);
    g.scale.setScalar(fitScale.current);
  }, [vp.width, vp.height]);
  useEffect(fit, [fit]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g || still) return;
    const p = progress.current ?? 0;
    // Scroll: the headline drifts up and back a little while the glass comes forward.
    g.position.y = MathUtils.damp(g.position.y, vp.height * (0.18 + p * 0.06), 6, delta);
    g.scale.setScalar(MathUtils.damp(g.scale.x, fitScale.current * (1 - p * 0.08), 6, delta));
  });

  return (
    <group ref={group} position={[0, vp.height * 0.18, z]}>
      <Text
        font={FONT}
        fontSize={1}
        lineHeight={0.9}
        textAlign="center"
        anchorX="center"
        anchorY="middle"
        color={INK}
        onSync={(t: TroikaText) => {
          const b = t.textRenderInfo?.blockBounds;
          if (!b || b.length < 4) return;
          bounds.current = { w: b[2]! - b[0]!, h: b[3]! - b[1]! };
          fit();
          onReady();
        }}
      >
        {'YOUR FRIENDS\n+ 3 AI AGENTS'}
      </Text>
    </group>
  );
}

// Rest pose, as in the reference product shot: seen a little from above (top edge and bumpers show),
// turned slightly left, right grip dipping.
const REST = { x: 0.34, y: 0.22, z: -0.12 };
const WIDTH = 4.9;
const HEIGHT = 3.0;

function Controller({ progress, still, quality }: { progress: RefObject<number>; still: boolean; quality: 'high' | 'low' }) {
  const group = useRef<Group>(null);
  const camera = useThree(s => s.camera);
  const viewport = useThree(s => s.viewport);
  const z = 1.5;
  const vp = viewport.getCurrentViewport(camera, [0, 0, z]);
  // About 46% of the width (85% on portrait phones), never taller than ~50% of the height; it sits
  // just below the middle, over the headline's second line, so the headline stays readable.
  const share = vp.width < vp.height ? 0.85 : 0.46;
  const base = Math.min((vp.width * share) / WIDTH, (vp.height * 0.5) / HEIGHT);
  const y0 = vp.height * 0.01;

  useFrame((state, delta) => {
    const g = group.current;
    if (!g || still) return;
    const p = progress.current ?? 0;
    const t = state.clock.elapsedTime;
    // Idle float + tilt toward the pointer + scroll: a gentle turn and zoom (it never swallows the page).
    g.rotation.x = MathUtils.damp(g.rotation.x, REST.x - state.pointer.y * 0.2 + Math.sin(t * 0.7) * 0.04 + p * 0.2, 4, delta);
    g.rotation.y = MathUtils.damp(g.rotation.y, REST.y + state.pointer.x * 0.3 + Math.sin(t * 0.5) * 0.05 - p * 0.5, 4, delta);
    g.rotation.z = MathUtils.damp(g.rotation.z, REST.z + Math.sin(t * 0.4) * 0.02 + p * 0.1, 4, delta);
    g.position.y = MathUtils.damp(g.position.y, y0 + Math.sin(t * 0.9) * 0.04 + p * vp.height * 0.06, 4, delta);
    g.scale.setScalar(MathUtils.damp(g.scale.x, base * (1 + p * 0.4), 5, delta));
  });

  return (
    <group ref={group} position={[0, y0, z]} rotation={[REST.x, REST.y, REST.z]} scale={base}>
      <GlassController quality={quality} />
    </group>
  );
}
