/**
 * VisualSoul3D.tsx — Three.js + GLSL 三維光球 (Phase 10)
 *
 * 架構：
 *   - React Three Fiber Canvas 渲染 WebGL 場景
 *   - 自訂 GLSL Vertex + Fragment Shader：物理光照 + Fresnel 邊緣光暈
 *   - 三種人格各有獨立顏色主題 + 呼吸週期
 *   - 三種 AI 狀態：idle(呼吸) / thinking(渦漩) / generating(爆發)
 *   - 尺寸自適應：sm/md/lg/xl
 *   - CSS fallback 當 WebGL 不可用時退回 VisualSoul
 */

import { useRef, useMemo, Suspense, lazy, useState, useEffect } from "react";
import { Canvas, useFrame, extend } from "@react-three/fiber";
import * as THREE from "three";
import type { AIState, Personality } from "./VisualSoul";

// ─── GLSL Shaders ─────────────────────────────────────────────────────────

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uState;        // 0=idle, 1=thinking, 2=generating
  uniform float uBreathSpeed;
  uniform float uPulseIntensity;

  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vFresnel;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;

    // ── 呼吸變形 ──
    float breathPhase = sin(uTime * uBreathSpeed) * 0.5 + 0.5;
    float breathScale = 1.0 + breathPhase * uPulseIntensity * 0.12;

    // ── thinking 狀態：Perlin-noise 擾動 ──
    float noiseAmt = 0.0;
    if (uState >= 0.9) { // thinking or generating
      float n = sin(position.x * 4.0 + uTime * 2.3)
              * cos(position.y * 3.7 + uTime * 1.9)
              * sin(position.z * 5.1 + uTime * 2.7);
      noiseAmt = n * 0.08 * uPulseIntensity;
    }

    // ── generating 狀態：外擴爆發 ──
    float burstAmt = 0.0;
    if (uState >= 1.9) {
      burstAmt = sin(uTime * 6.0) * 0.06;
    }

    vec3 displaced = position * (breathScale + noiseAmt + burstAmt);

    // ── Fresnel 邊緣光 ──
    vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
    vec3 viewDir = normalize(cameraPosition - worldPosition.xyz);
    vFresnel = 1.0 - abs(dot(vNormal, viewDir));

    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uState;
  uniform vec3  uColorPrimary;
  uniform vec3  uColorSecondary;
  uniform vec3  uColorAccent;
  uniform float uEmissiveIntensity;

  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vFresnel;

  void main() {
    // ── 基礎光照 ──
    vec3 lightDir = normalize(vec3(1.0, 1.5, 2.0));
    float diff = max(dot(vNormal, lightDir), 0.0);
    float ambient = 0.55;  // 更高 ambient，整體更亮

    // ── 色彩混合（隨時間旋轉） ──
    float t = uTime * 0.4;
    float mixA = sin(t) * 0.5 + 0.5;
    float mixB = cos(t * 0.7 + 1.0) * 0.5 + 0.5;
    vec3 baseColor = mix(
      mix(uColorPrimary, uColorSecondary, mixA),
      uColorAccent,
      mixB * 0.35
    );

    // ── 亮色系：中心純白，邊緣保留彩色 ──
    float centerGlow = pow(max(0.0, 1.0 - length(vPosition) * 1.2), 2.0);
    baseColor = mix(baseColor, vec3(1.0), centerGlow * 0.55);

    // ── 深度感：邊緣透明化（去背感） ──
    float depth = 1.0 - length(vPosition) * 0.6;
    depth = clamp(depth, 0.3, 1.0);

    // ── Fresnel 邊緣光暈（更強烈的彩色邊光） ──
    vec3 fresnelColor = mix(uColorPrimary, uColorAccent, 0.5) * pow(vFresnel, 1.8) * 2.5;

    // ── thinking 狀態：旋轉光帶 ──
    float spiral = 0.0;
    if (uState >= 0.9) {
      spiral = sin(vPosition.y * 8.0 + uTime * 4.0) * 0.4 * uState;
    }

    // ── generating 狀態：熱光核心（白熱化） ──
    float hotCore = 0.0;
    if (uState >= 1.9) {
      hotCore = pow(max(0.0, 1.0 - length(vPosition) * 2.5), 3.0) * 1.2;
    }

    vec3 finalColor = baseColor * (ambient + diff * 0.55) * depth;
    finalColor += fresnelColor;
    finalColor += vec3(spiral * 0.6);
    finalColor += vec3(1.0) * hotCore;  // 白熱核心
    finalColor *= uEmissiveIntensity;

    // ── Specular highlight（更強高光） ──
    vec3 viewDir = normalize(vec3(0.0, 0.0, 1.0));
    vec3 halfDir = normalize(lightDir + viewDir);
    float spec = pow(max(dot(vNormal, halfDir), 0.0), 48.0);
    finalColor += vec3(spec * 0.7);

    // ── 邊緣透明（去背感）：Fresnel 邊緣降低 alpha ──
    float edgeAlpha = 1.0 - pow(vFresnel, 3.0) * 0.5;
    float alpha = min(edgeAlpha, 0.95);

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

// ─── Personality → Shader Uniforms ────────────────────────────────────────

const PERSONALITY_UNIFORMS: Record<Personality, {
  colorPrimary: [number, number, number];
  colorSecondary: [number, number, number];
  colorAccent: [number, number, number];
  breathSpeed: number;
  pulseIntensity: number;
  emissiveIntensity: number;
}> = {
  calm: {
    colorPrimary:   [0.00, 0.82, 1.00],   // 亮青 #00D2FF
    colorSecondary: [0.39, 0.94, 1.00],   // 天藍白 #64EFFF
    colorAccent:    [0.78, 1.00, 1.00],   // 冰白青 #C8FFFF
    breathSpeed:    0.7,
    pulseIntensity: 0.4,
    emissiveIntensity: 2.2,
  },
  creative: {
    colorPrimary:   [1.00, 0.31, 0.71],   // 亮粉 #FF50B5
    colorSecondary: [1.00, 0.63, 0.24],   // 橘粉 #FFA03D
    colorAccent:    [1.00, 0.90, 0.00],   // 亮黃 #FFE600
    breathSpeed:    1.8,
    pulseIntensity: 0.8,
    emissiveIntensity: 2.4,
  },
  technical: {
    colorPrimary:   [0.31, 1.00, 0.71],   // 亮綠 #50FFB5
    colorSecondary: [0.00, 0.78, 0.47],   // 翠綠 #00C778
    colorAccent:    [0.59, 1.00, 0.78],   // 薄荷 #96FFC7
    breathSpeed:    2.5,
    pulseIntensity: 0.6,
    emissiveIntensity: 2.2,
  },
};

const STATE_VALUE: Record<AIState, number> = {
  idle: 0.0,
  thinking: 1.0,
  generating: 2.0,
};

// ─── The 3D Orb Mesh ───────────────────────────────────────────────────────

function OrbMesh({
  personality,
  state,
}: {
  personality: Personality;
  state: AIState;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const cfg = PERSONALITY_UNIFORMS[personality];

  const uniforms = useMemo(
    () => ({
      uTime:             { value: 0 },
      uState:            { value: STATE_VALUE[state] },
      uBreathSpeed:      { value: cfg.breathSpeed },
      uPulseIntensity:   { value: cfg.pulseIntensity },
      uEmissiveIntensity:{ value: cfg.emissiveIntensity },
      uColorPrimary:     { value: new THREE.Color(...cfg.colorPrimary) },
      uColorSecondary:   { value: new THREE.Color(...cfg.colorSecondary) },
      uColorAccent:      { value: new THREE.Color(...cfg.colorAccent) },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [personality]
  );

  // Update state uniform reactively (no remount needed)
  useEffect(() => {
    uniforms.uState.value = STATE_VALUE[state];
  }, [state, uniforms]);

  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.getElapsedTime();
    // Slow rotation
    if (meshRef.current) {
      meshRef.current.rotation.y = clock.getElapsedTime() * 0.25;
      meshRef.current.rotation.x = Math.sin(clock.getElapsedTime() * 0.15) * 0.1;
    }
  });

  return (
    <mesh ref={meshRef}>
      {/* Higher segments = smoother sphere = better GLSL displacement */}
      <sphereGeometry args={[1, 64, 64]} />
      <shaderMaterial
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        uniforms={uniforms}
        transparent={true}
        side={THREE.FrontSide}
      />
    </mesh>
  );
}

// ─── Particle Ring (orbiting dots) ────────────────────────────────────────

function ParticleRing({
  personality,
  state,
  count = 8,
}: {
  personality: Personality;
  state: AIState;
  count?: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const cfg = PERSONALITY_UNIFORMS[personality];

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    groupRef.current.rotation.y = t * (state === "generating" ? 3.0 : 0.8);
    groupRef.current.rotation.x = Math.sin(t * 0.4) * 0.3;
  });

  const particles = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2;
      const radius = 1.5;
      return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * 0.4,
        z: Math.sin(angle) * radius,
        delay: i * 0.15,
      };
    });
  }, [count]);

  const opacity = state === "idle" ? 0.4 : state === "thinking" ? 0.7 : 1.0;
  const color = new THREE.Color(...cfg.colorAccent);

  return (
    <group ref={groupRef}>
      {particles.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Bloom Post-Processing (simulated via ambient glow plane) ─────────────

function GlowPlane({ personality }: { personality: Personality }) {
  // 移除背景平面，改為純透明（去背效果）
  return null;
}

// ─── Size Map ──────────────────────────────────────────────────────────────

const SIZE_PX: Record<string, number> = {
  sm: 24,
  md: 40,
  lg: 56,
  xl: 80,
};

// ─── Main 3D Component ─────────────────────────────────────────────────────

interface VisualSoul3DProps {
  personality?: Personality;
  state?: AIState;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

export default function VisualSoul3D({
  personality = "creative",
  state = "idle",
  size = "md",
  className = "",
}: VisualSoul3DProps) {
  const px = SIZE_PX[size] ?? 40;
  const showParticles = size !== "sm";
  const particleCount = size === "xl" ? 12 : 8;

  // Pause rendering when tab is hidden to save GPU/CPU
  const [frameloop, setFrameloop] = useState<"always" | "never">("always");
  useEffect(() => {
    const onVisibility = () => setFrameloop(document.hidden ? "never" : "always");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const glowColor = PERSONALITY_UNIFORMS[personality].colorPrimary
    .map((v) => Math.round(v * 255))
    .join(", ");

  // 多層光暈強化亮色感
  const accentColor = PERSONALITY_UNIFORMS[personality].colorAccent
    .map((v) => Math.round(v * 255))
    .join(", ");

  return (
    <div
      className={`relative ${className}`}
      style={{
        width: px,
        height: px,
        filter: [
          `drop-shadow(0 0 ${px * 0.5}px rgba(${glowColor}, 0.9))`,
          `drop-shadow(0 0 ${px * 0.8}px rgba(${glowColor}, 0.5))`,
          `drop-shadow(0 0 ${px * 1.2}px rgba(${accentColor}, 0.3))`,
        ].join(" "),
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 3], fov: 45 }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "default",
        }}
        style={{ width: "100%", height: "100%", background: "transparent" }}
        frameloop={frameloop}
      >
        <ambientLight intensity={0.8} />
        <pointLight position={[2, 3, 4]} intensity={2.0} color={new THREE.Color(1, 1, 1)} />
        <pointLight position={[-2, -1, -3]} intensity={1.2} color={new THREE.Color(...PERSONALITY_UNIFORMS[personality].colorAccent)} />
        <pointLight position={[0, 2, 2]} intensity={1.5} color={new THREE.Color(...PERSONALITY_UNIFORMS[personality].colorPrimary)} />

        <Suspense fallback={null}>
          <OrbMesh personality={personality} state={state} />
          {showParticles && (
            <ParticleRing
              personality={personality}
              state={state}
              count={particleCount}
            />
          )}
          <GlowPlane personality={personality} />
        </Suspense>
      </Canvas>
    </div>
  );
}
