/**
 * AmbientVideo.tsx — HLS 動態解析度滿版背景影片播放器
 *
 * 使用 hls.js 實作 HTTP Live Streaming 動態分片解析度串流，
 * 防止初期載入龐大 MP4 的煩躁感。
 *
 * 功能：
 *   - HLS 自適應位元率串流（ABR）
 *   - Safari 原生 HLS 支援偵測（不載入 hls.js polyfill）
 *   - autoplay / muted / loop / playsinline 屬性綁定
 *   - 滿版背景佈局（object-fit: cover + fixed positioning）
 *   - 載入中顯示半透明遮罩，影片就緒後淡入
 *   - 錯誤容錯：HLS 不可用時靜默降級（不影響其他元件）
 */

import { useRef, useEffect, useState, memo, useCallback } from "react";
import Hls from "hls.js";

interface AmbientVideoProps {
  /** HLS .m3u8 播放清單 URL */
  src: string;
  /** 備援 MP4 URL（當 HLS 完全不支援時使用） */
  fallbackSrc?: string;
  /** 額外的 CSS class */
  className?: string;
  /** 影片上方的半透明遮罩透明度 0–1（預設 0.3） */
  overlayOpacity?: number;
  /** 影片就緒後的淡入時間（ms，預設 1000） */
  fadeInDuration?: number;
}

function AmbientVideoInner({
  src,
  fallbackSrc,
  className = "",
  overlayOpacity = 0.3,
  fadeInDuration = 1000,
}: AmbientVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [hasError, setHasError] = useState(false);

  const handleCanPlay = useCallback(() => {
    setIsReady(true);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let hls: Hls | null = null;

    // Case 1: Browser natively supports HLS (Safari, iOS)
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.addEventListener("canplay", handleCanPlay);
      video.play().catch(() => {
        // Autoplay blocked — silent fail, ambient video is non-essential
      });
      return () => {
        video.removeEventListener("canplay", handleCanPlay);
      };
    }

    // Case 2: Use hls.js polyfill
    if (Hls.isSupported()) {
      hls = new Hls({
        // Start with lowest quality for fast initial load, then adapt upward
        startLevel: -1, // Auto
        capLevelToPlayerSize: true,
        maxBufferLength: 10,
        maxMaxBufferLength: 30,
        // Low latency is not needed for ambient video
        lowLatencyMode: false,
        // Gentle ABR switching
        abrEwmaDefaultEstimate: 500000, // 500kbps initial estimate
        abrBandWidthUpFactor: 0.7,
        abrBandWidthFactor: 0.95,
      });

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {
          // Autoplay blocked — silent fail
        });
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // Try to recover from network error
              hls?.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              // Try to recover from media error
              hls?.recoverMediaError();
              break;
            default:
              // Unrecoverable error — fall back
              setHasError(true);
              hls?.destroy();
              break;
          }
        }
      });

      video.addEventListener("canplay", handleCanPlay);
      hlsRef.current = hls;

      return () => {
        video.removeEventListener("canplay", handleCanPlay);
        hls?.destroy();
        hlsRef.current = null;
      };
    }

    // Case 3: Neither native HLS nor hls.js supported — use fallback MP4
    if (fallbackSrc) {
      video.src = fallbackSrc;
      video.addEventListener("canplay", handleCanPlay);
      video.play().catch(() => {});
      return () => {
        video.removeEventListener("canplay", handleCanPlay);
      };
    }

    // No playback method available
    setHasError(true);
    return undefined;
  }, [src, fallbackSrc, handleCanPlay]);

  // If error and no fallback, don't render anything
  if (hasError && !fallbackSrc) {
    return null;
  }

  return (
    <div
      className={`absolute inset-0 overflow-hidden ${className}`}
      style={{ zIndex: 0 }}
      aria-hidden="true"
    >
      {/* Video element */}
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          opacity: isReady ? 1 : 0,
          transition: `opacity ${fadeInDuration}ms ease-in-out`,
        }}
      />

      {/* Dark overlay for text readability */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundColor: `rgba(0, 0, 0, ${overlayOpacity})`,
          zIndex: 1,
        }}
      />
    </div>
  );
}

export const AmbientVideo = memo(AmbientVideoInner);
export default AmbientVideo;
