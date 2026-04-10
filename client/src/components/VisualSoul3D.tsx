/**
 * VisualSoul3D.tsx — Three.js 3D 光球元件 (Phase 10)
 *
 * 使用 React Three Fiber 實作白皮書要求的 3D 光球伴侶：
 * - 物理光球材質（MeshPhysicalMaterial）
 * - XState 人格引擎驅動顏色/速度
 * - 呼吸動效（Calm=6s, Creative=3s, Technical=1.5s）
 * - 根據 AIState 切換 idle/thinking/generating 狀態
 *
 * 若 WebGL 不支援，自動降級至 CSS 版本（VisualSoul.tsx）
 */

import { Suspense, useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { MeshDistortMaterial, Float } from "@react-three/drei";
import * as THREE from "three";
import { usePersonality } from "@/contexts/PersonalityContext";
import { useAIState } from "@/contexts/AIStateContext";

// ─── 3D 光球核心 ───────────────────────────────────────────────────────────

function OrbMesh() {
  const meshRef = useRef<THREE.Mesh>(null);
  const { config } = usePersonality();
  const { aiState } = useAIState();

  // 根據 AI 狀態決定動效參數
  const animParams = useMemo(() => {
    switch (aiState) {
      case "thinking":
        return { distort: 0.6, speed: 3, rotationSpeed: 0.008 };
      case "generating":
        return { distort: 0.8, speed: 5, rotationSpeed: 0.015 };
      default: // idle
        return { distort: 0.3, speed: config.breathSpeed, rotationSpeed: 0.003 };
    }
  }, [aiState, config.breathSpeed]);

  // 顏色從字串解析為 THREE.Color
  const color = useMemo(() => new THREE.Color(config.color), [config.color]);
  const emissiveColor = useMemo(() => new THREE.Color(config.color), [config.color]);

  // 每幀動畫：呼吸縮放 + 緩慢旋轉
  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime();

    // 呼吸動效
    const breathCycle = (2 * Math.PI) / config.breathSpeed;
    const scale = 1 + Math.sin(t * breathCycle) * 0.08 * config.pulseIntensity;
    meshRef.current.scale.setScalar(scale);

    // 緩慢旋轉
    meshRef.current.rotation.y += animParams.rotationSpeed;
    meshRef.current.rotation.x = Math.sin(t * 0.3) * 0.1;
  });

  return (
    <Float speed={1.5} rotationIntensity={0.2} floatIntensity={0.5}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[1, 64, 64]} />
        <MeshDistortMaterial
          color={color}
          emissive={emissiveColor}
          emissiveIntensity={config.emissiveIntensity}
          distort={animParams.distort}
          speed={animParams.speed}
          roughness={0.1}
          metalness={0.1}
          transparent
          opacity={0.9}
        />
      </mesh>
    </Float>
  );
}

// ─── 光暈效果 ──────────────────────────────────────────────────────────────

function OrbGlow() {
  const meshRef = useRef<THREE.Mesh>(null);
  const { config } = usePersonality();
  const glowColor = useMemo(() => new THREE.Color(config.color), [config.color]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime();
    const opacity = 0.15 + Math.sin(t * 1.5) * 0.05;
    (meshRef.current.material as THREE.MeshBasicMaterial).opacity = opacity;
  });

  return (
    <mesh ref={meshRef} scale={1.4}>
      <sphereGeometry args={[1, 32, 32]} />
      <meshBasicMaterial color={glowColor} transparent opacity={0.15} side={THREE.BackSide} />
    </mesh>
  );
}

// ─── 場景燈光 ─────────────────────────────────────────────────────────────

function SceneLights() {
  const { config } = usePersonality();
  const lightColor = useMemo(() => new THREE.Color(config.color), [config.color]);

  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[2, 3, 2]} intensity={1.5} color={lightColor} />
      <pointLight position={[-2, -1, -2]} intensity={0.5} color="#ffffff" />
    </>
  );
}

// ─── 降級 CSS 光球 ─────────────────────────────────────────────────────────

function FallbackOrb({ size = 80 }: { size?: number }) {
  const { config } = usePersonality();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(circle at 35% 35%, ${config.color}cc, ${config.color}44)`,
        boxShadow: `0 0 ${size * 0.4}px ${config.glowColor}`,
        animation: `pulse ${config.breathSpeed}s ease-in-out infinite`,
      }}
    />
  );
}

// ─── 主元件 ───────────────────────────────────────────────────────────────

interface VisualSoul3DProps {
  size?: number;
  className?: string;
}

export default function VisualSoul3D({ size = 80, className }: VisualSoul3DProps) {
  const { config } = usePersonality();

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        position: "relative",
        filter: `drop-shadow(0 0 ${size * 0.25}px ${config.glowColor})`,
      }}
    >
      <Suspense fallback={<FallbackOrb size={size} />}>
        <Canvas
          camera={{ position: [0, 0, 3], fov: 45 }}
          gl={{ antialias: true, alpha: true }}
          style={{ background: "transparent" }}
        >
          <SceneLights />
          <OrbGlow />
          <OrbMesh />
        </Canvas>
      </Suspense>
    </div>
  );
}
