/**
 * EarthGlobeAnimation — 世界觀系統的沉浸式地球動畫背景
 *
 * 提供地球旋轉動畫、星空背景、氛圍光效等視覺效果
 * 用於世界觀系統的沉浸式模式
 */

import { useEffect, useRef, memo } from "react";
import { Globe } from "lucide-react";

export const EarthGlobeAnimation = memo(function EarthGlobeAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const updateSize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    updateSize();
    window.addEventListener("resize", updateSize);

    // Animation state
    let animationFrameId: number;
    let rotation = 0;
    const stars: Array<{ x: number; y: number; size: number; opacity: number; twinkleSpeed: number; twinklePhase: number }> = [];

    // Generate random stars with twinkling effect
    for (let i = 0; i < 250; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 2 + 0.5,
        opacity: Math.random() * 0.5 + 0.3,
        twinkleSpeed: Math.random() * 0.02 + 0.01,
        twinklePhase: Math.random() * Math.PI * 2,
      });
    }

    const animate = () => {
      if (!ctx || !canvas) return;

      // Clear canvas with dark space background gradient
      const bgGradient = ctx.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        0,
        canvas.width / 2,
        canvas.height / 2,
        Math.max(canvas.width, canvas.height) * 0.8
      );
      bgGradient.addColorStop(0, "rgba(20, 20, 40, 1)");
      bgGradient.addColorStop(0.5, "rgba(15, 15, 30, 1)");
      bgGradient.addColorStop(1, "rgba(10, 10, 20, 1)");
      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw twinkling stars
      stars.forEach(star => {
        const twinkle = Math.sin(rotation * star.twinkleSpeed * 100 + star.twinklePhase) * 0.3 + 0.7;
        ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity * twinkle})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();

        // Add occasional bright stars with glow
        if (star.size > 1.5 && twinkle > 0.9) {
          ctx.fillStyle = `rgba(200, 220, 255, ${star.opacity * 0.3})`;
          ctx.beginPath();
          ctx.arc(star.x, star.y, star.size * 2, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Draw earth globe in center
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const radius = Math.min(canvas.width, canvas.height) * 0.18;

      // Earth outer glow effect (blue atmosphere)
      const outerGlow = ctx.createRadialGradient(centerX, centerY, radius * 0.9, centerX, centerY, radius * 1.8);
      outerGlow.addColorStop(0, "rgba(100, 150, 255, 0.4)");
      outerGlow.addColorStop(0.3, "rgba(100, 150, 255, 0.2)");
      outerGlow.addColorStop(0.7, "rgba(100, 150, 255, 0.05)");
      outerGlow.addColorStop(1, "rgba(100, 150, 255, 0)");
      ctx.fillStyle = outerGlow;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 1.8, 0, Math.PI * 2);
      ctx.fill();

      // Earth sphere with realistic gradient
      const earthGradient = ctx.createRadialGradient(
        centerX - radius * 0.3,
        centerY - radius * 0.3,
        radius * 0.1,
        centerX,
        centerY,
        radius * 1.1
      );
      earthGradient.addColorStop(0, "rgba(150, 200, 255, 1)");
      earthGradient.addColorStop(0.3, "rgba(80, 140, 220, 1)");
      earthGradient.addColorStop(0.6, "rgba(40, 90, 180, 1)");
      earthGradient.addColorStop(0.85, "rgba(20, 50, 120, 1)");
      earthGradient.addColorStop(1, "rgba(10, 30, 80, 0.9)");

      ctx.fillStyle = earthGradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fill();

      // Draw continents with better distribution and rotation
      ctx.fillStyle = "rgba(100, 200, 120, 0.5)";
      const numContinents = 12;
      for (let i = 0; i < numContinents; i++) {
        const angle = (rotation + i * Math.PI * 2 / numContinents + i * 0.5) % (Math.PI * 2);
        const latitudeVariation = Math.sin(i * 2.3) * 0.4; // Vary latitude
        const x = centerX + Math.cos(angle) * radius * 0.65;
        const y = centerY + Math.sin(angle) * radius * 0.4 + latitudeVariation * radius * 0.3;
        const size = radius * (0.12 + Math.sin(i * 1.7) * 0.08);

        // Only draw continents on visible side
        const visibility = Math.max(0, Math.cos(angle));

        if (visibility > 0.1) {
          ctx.save();
          ctx.globalAlpha = visibility * 0.7;
          ctx.beginPath();
          ctx.ellipse(x, y, size, size * 0.6, angle + rotation * 0.5, 0, Math.PI * 2);
          ctx.fill();

          // Add some texture with smaller islands
          if (size > radius * 0.15) {
            ctx.fillStyle = "rgba(80, 180, 100, 0.4)";
            ctx.beginPath();
            ctx.ellipse(x + size * 0.3, y - size * 0.2, size * 0.3, size * 0.2, angle, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }

      // Add cloud layer
      ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
      for (let i = 0; i < 8; i++) {
        const angle = (rotation * 0.7 + i * Math.PI * 2 / 8) % (Math.PI * 2);
        const x = centerX + Math.cos(angle) * radius * 0.7;
        const y = centerY + Math.sin(angle) * radius * 0.5;
        const cloudSize = radius * (0.15 + Math.random() * 0.1);
        const visibility = Math.max(0, Math.cos(angle));

        if (visibility > 0.2) {
          ctx.save();
          ctx.globalAlpha = visibility * 0.4;
          ctx.beginPath();
          ctx.ellipse(x, y, cloudSize, cloudSize * 0.5, angle, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // Atmosphere edge glow with multiple layers
      ctx.strokeStyle = "rgba(150, 200, 255, 0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius + 1, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "rgba(180, 220, 255, 0.3)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius + 3, 0, Math.PI * 2);
      ctx.stroke();

      // Add subtle particles/auroras around earth
      const particleCount = 5;
      for (let i = 0; i < particleCount; i++) {
        const particleAngle = rotation * 2 + i * Math.PI * 2 / particleCount;
        const particleRadius = radius * 1.2;
        const px = centerX + Math.cos(particleAngle) * particleRadius;
        const py = centerY + Math.sin(particleAngle) * particleRadius * 0.6;

        const particleGlow = ctx.createRadialGradient(px, py, 0, px, py, 15);
        particleGlow.addColorStop(0, "rgba(150, 200, 255, 0.6)");
        particleGlow.addColorStop(1, "rgba(150, 200, 255, 0)");
        ctx.fillStyle = particleGlow;
        ctx.beginPath();
        ctx.arc(px, py, 15, 0, Math.PI * 2);
        ctx.fill();
      }

      // Update rotation (slower for more majestic feel)
      rotation += 0.0015;

      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("resize", updateSize);
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-0">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{
          background: "radial-gradient(ellipse at center, rgba(20,20,40,1) 0%, rgba(10,10,20,1) 100%)"
        }}
      />
      {/* Add subtle vignette effect */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0.3) 100%)",
          pointerEvents: "none"
        }}
      />
    </div>
  );
});

/**
 * SimpleEarthIcon — 靜態地球圖標（用於按鈕等非動畫場景）
 */
export const SimpleEarthIcon = memo(function SimpleEarthIcon({ className }: { className?: string }) {
  return (
    <Globe className={className} />
  );
});
