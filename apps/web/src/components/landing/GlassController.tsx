'use client';

import { MeshTransmissionMaterial, RoundedBox, useFBO } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { ExtrudeGeometry, Shape, Vector2, type Group, type Texture } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A clear glass gamepad in the classic console shape, built from code (no downloaded model, no brand
 * marks): a thick, pillowy body with long grips, raised sticks, a D-pad, four domed face buttons, a
 * guide button and bumpers. Every part is refractive glass that bends the headline behind it.
 *
 * All parts share ONE refraction buffer (the scene rendered once per frame without the controller),
 * instead of each running its own pass; mixing passes is what drew black streaks before.
 * Units: about 4.9 wide, 3.0 tall; the face points at +z.
 */

type Seg = [Vector2, Vector2, Vector2, Vector2]; // start, control 1, control 2, end
const v = (x: number, y: number) => new Vector2(x, y);

// Right half of the outline, from top centre clockwise to bottom centre.
const RIGHT: Seg[] = [
  [v(0, 1.04), v(0.5, 1.0), v(1.0, 1.16), v(1.42, 1.12)], // top edge, slight dip in the middle
  [v(1.42, 1.12), v(1.96, 1.07), v(2.22, 0.84), v(2.27, 0.52)], // shoulder
  [v(2.27, 0.52), v(2.33, 0.12), v(2.62, -0.92), v(2.36, -1.46)], // outer grip, flaring out
  [v(2.36, -1.46), v(2.16, -1.88), v(1.66, -1.86), v(1.52, -1.48)], // grip tip
  [v(1.52, -1.48), v(1.34, -1.04), v(1.02, -0.64), v(0.56, -0.64)], // inner grip
  [v(0.56, -0.64), v(0.36, -0.64), v(0.18, -0.6), v(0, -0.6)], // bottom centre
];

function bodyShape(): Shape {
  const mirror = (p: Vector2) => v(-p.x, p.y);
  // The left half: the right half mirrored and walked backwards (bottom centre → top centre).
  const left: Seg[] = [...RIGHT].reverse().map(([a, c1, c2, b]) => [mirror(b), mirror(c2), mirror(c1), mirror(a)]);
  const shape = new Shape();
  shape.moveTo(RIGHT[0]![0].x, RIGHT[0]![0].y);
  for (const [, c1, c2, b] of [...RIGHT, ...left]) shape.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
  return shape;
}

const DEPTH = 0.72;
const BEVEL = 0.38;
/** z of the front face (extrusion is centred on z = 0). */
const FACE_Z = DEPTH / 2 + BEVEL;

// Face buttons: clear glass with a faint tint of lime and the agents (our touch on the classic pad).
const FACE_BUTTONS = [
  { x: 1.36, y: 0.72, tint: '#f1ffc9' }, // top: brand lime
  { x: 1.7, y: 0.4, tint: '#e9e0ff' }, // right: Pixel violet
  { x: 1.36, y: 0.08, tint: '#d9f7ff' }, // bottom: Glitch cyan
  { x: 1.02, y: 0.4, tint: '#fff1cf' }, // left: Forge amber
];
const STICKS: Array<[number, number]> = [
  [-1.32, 0.4], // left: top-left
  [0.7, -0.3], // right: bottom-right
];

function Glass({ buffer, tint = '#ffffff', thickness = 0.5 }: { buffer: Texture; tint?: string; thickness?: number }) {
  return (
    <MeshTransmissionMaterial
      buffer={buffer}
      transmission={1}
      thickness={thickness}
      roughness={0}
      ior={1.45}
      chromaticAberration={0.12}
      anisotropicBlur={0}
      distortion={0}
      clearcoat={1}
      clearcoatRoughness={0}
      envMapIntensity={2}
      color={tint}
      samples={6}
    />
  );
}

export function GlassController({ quality }: { quality: 'high' | 'low' }) {
  const glass = useRef<Group>(null);
  const fbo = useFBO(); // canvas-sized, so the refracted headline stays sharp
  const buffer = fbo.texture;

  // Render the scene without the controller into the shared buffer, once per frame.
  useFrame(({ gl, scene, camera }) => {
    const g = glass.current;
    if (!g) return;
    g.visible = false;
    gl.setRenderTarget(fbo);
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    g.visible = true;
  });

  const body = useMemo(() => {
    const g = new ExtrudeGeometry(bodyShape(), {
      depth: DEPTH,
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: 0.28,
      bevelSegments: quality === 'high' ? 16 : 8,
      curveSegments: quality === 'high' ? 80 : 40,
    });
    g.translate(0, 0, -DEPTH / 2);
    // Extrude gives one flat normal per triangle; refraction turns those facets into jagged lines.
    // Weld shared vertices (normals/uvs dropped so they can merge) and recompute smooth normals.
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    const smooth = mergeVertices(g, 1e-4);
    smooth.computeVertexNormals();
    g.dispose();
    return smooth;
  }, [quality]);

  const z = FACE_Z;
  return (
    <group ref={glass}>
      <mesh geometry={body}>
        <Glass buffer={buffer} thickness={0.55} />
      </mesh>

      {/* Sticks: a well ring on the face, a stem, and a cap with a raised grip ring. */}
      {STICKS.map(([x, y]) => (
        <group key={x} position={[x, y, z - 0.04]}>
          <mesh>
            <torusGeometry args={[0.46, 0.07, 24, 64]} />
            <Glass buffer={buffer} thickness={0.2} />
          </mesh>
          <mesh position-z={0.16} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.28, 0.34, 0.3, 48]} />
            <Glass buffer={buffer} thickness={0.6} />
          </mesh>
          <mesh position-z={0.36} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.42, 0.42, 0.12, 64]} />
            <Glass buffer={buffer} thickness={0.4} />
          </mesh>
          <mesh position-z={0.43}>
            <torusGeometry args={[0.36, 0.07, 24, 64]} />
            <Glass buffer={buffer} thickness={0.2} />
          </mesh>
        </group>
      ))}

      {/* D-pad, bottom-left. */}
      <group position={[-0.7, -0.3, z + 0.06]}>
        <RoundedBox args={[0.78, 0.27, 0.18]} radius={0.07} smoothness={4}>
          <Glass buffer={buffer} thickness={0.35} />
        </RoundedBox>
        <RoundedBox args={[0.27, 0.78, 0.18]} radius={0.07} smoothness={4}>
          <Glass buffer={buffer} thickness={0.35} />
        </RoundedBox>
      </group>

      {/* Face buttons: domes. */}
      {FACE_BUTTONS.map(b => (
        <mesh key={b.tint} position={[b.x, b.y, z]} scale={[1, 1, 0.75]}>
          <sphereGeometry args={[0.19, 48, 32]} />
          <Glass buffer={buffer} tint={b.tint} thickness={0.4} />
        </mesh>
      ))}

      {/* Guide button (no logo) and the two small centre buttons. */}
      <mesh position={[0, 0.74, z - 0.02]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.21, 0.21, 0.1, 64]} />
        <Glass buffer={buffer} tint="#f1ffc9" thickness={0.3} />
      </mesh>
      {[-0.36, 0.36].map(x => (
        <mesh key={x} position={[x, 0.36, z - 0.01]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.085, 0.085, 0.08, 32]} />
          <Glass buffer={buffer} thickness={0.2} />
        </mesh>
      ))}

      {/* Bumpers along the top edge. */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * 1.5, 1.08, -0.05]} rotation={[0, 0, Math.PI / 2 - s * 0.2]}>
          <capsuleGeometry args={[0.2, 0.8, 8, 32]} />
          <Glass buffer={buffer} thickness={0.4} />
        </mesh>
      ))}
    </group>
  );
}
