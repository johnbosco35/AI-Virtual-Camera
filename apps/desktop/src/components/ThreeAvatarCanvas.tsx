import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { TrackingMetrics } from '@/hooks/useFaceTracking';
import type { AvatarId, BackgroundPreset } from '@/store/appStore';
import { AvatarPreview } from '@/components/AvatarPreview';

type FacePoint = { x: number; y: number; z: number };

interface ThreeAvatarCanvasProps {
  metrics: TrackingMetrics;
  tracking: boolean;
  avatar: AvatarId;
  customImageUrl?: string | null;
  sourceFaceLandmarks?: FacePoint[];
  faceMeshTriangles?: [number, number, number][];
  templateError?: string | null;
  background?: BackgroundPreset;
  backgroundImageUrl?: string | null;
}

const palettes = {
  aria: { skin: '#e8b99a', hair: '#283a47', shirt: '#387a78' },
  sol: { skin: '#c98562', hair: '#8a552e', shirt: '#be773f' },
  milo: { skin: '#8c5947', hair: '#242b35', shirt: '#536a9a' },
};

function drawBackground(context: CanvasRenderingContext2D, preset: BackgroundPreset, image: HTMLImageElement | null) {
  const { width, height } = context.canvas;
  if (image?.complete && image.naturalWidth > 0) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    return;
  }
  const colors: Record<BackgroundPreset, [string, string]> = {
    scene: ['#e9f4f1', '#d7e8e4'],
    blur: ['#dbeafe', '#e9d5ff'],
    solid: ['#28535b', '#28535b'],
    midnight: ['#152341', '#3b3b69'],
    sunset: ['#f9a875', '#7d497e'],
    mint: ['#d9f3e8', '#92c9b3'],
    mountains: ['#9ec9d5', '#d6e5c4'],
    city: ['#f6d5bd', '#8ba7c7'],
    custom: ['#e9f4f1', '#d7e8e4'],
  };
  if (preset === 'solid') {
    context.fillStyle = colors.solid[0];
    context.fillRect(0, 0, width, height);
    return;
  }
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, colors[preset][0]);
  gradient.addColorStop(1, colors[preset][1]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  if (preset === 'blur') {
    context.save();
    context.filter = 'blur(32px)';
    context.fillStyle = 'rgba(255,255,255,.48)';
    context.beginPath();
    context.ellipse(82, 120, 115, 82, -0.5, 0, Math.PI * 2);
    context.ellipse(420, 286, 145, 105, 0.4, 0, Math.PI * 2);
    context.fill();
    context.restore();
  } else if (preset === 'scene') {
    context.fillStyle = 'rgba(255,255,255,.32)';
    context.beginPath();
    context.ellipse(110, 125, 125, 94, -0.5, 0, Math.PI * 2);
    context.ellipse(416, 300, 158, 118, 0.4, 0, Math.PI * 2);
    context.fill();
  } else if (preset === 'sunset') {
    context.fillStyle = 'rgba(255,227,160,.8)';
    context.beginPath();
    context.arc(385, 120, 58, 0, Math.PI * 2);
    context.fill();
  } else if (preset === 'mountains') {
    context.fillStyle = '#719e9c';
    context.beginPath();
    context.moveTo(0, 330);
    context.lineTo(145, 145);
    context.lineTo(265, 330);
    context.lineTo(390, 180);
    context.lineTo(512, 340);
    context.lineTo(512, 410);
    context.lineTo(0, 410);
    context.fill();
  } else if (preset === 'city') {
    context.fillStyle = 'rgba(38,60,88,.42)';
    for (const [x, buildingWidth, buildingHeight] of [[15, 74, 145], [105, 85, 205], [208, 68, 128], [290, 92, 175], [400, 96, 235]]) {
      context.fillRect(x, 410 - buildingHeight, buildingWidth, buildingHeight);
    }
  }
}

function drawTexturedTriangle(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  source: [FacePoint, FacePoint, FacePoint],
  target: [FacePoint, FacePoint, FacePoint],
) {
  const [a, b, c] = source;
  const [u, v, w] = target;
  const determinant = (a.x - c.x) * (b.y - c.y) - (b.x - c.x) * (a.y - c.y);
  if (Math.abs(determinant) < 0.001) return;

  const scaleX = ((u.x - w.x) * (b.y - c.y) - (v.x - w.x) * (a.y - c.y)) / determinant;
  const skewX = ((a.x - c.x) * (v.x - w.x) - (b.x - c.x) * (u.x - w.x)) / determinant;
  const translateX = u.x - scaleX * a.x - skewX * a.y;
  const scaleY = ((u.y - w.y) * (b.y - c.y) - (v.y - w.y) * (a.y - c.y)) / determinant;
  const skewY = ((a.x - c.x) * (v.y - w.y) - (b.x - c.x) * (u.y - w.y)) / determinant;
  const translateY = u.y - scaleY * a.x - skewY * a.y;

  context.save();
  context.beginPath();
  context.moveTo(u.x, u.y);
  context.lineTo(v.x, v.y);
  context.lineTo(w.x, w.y);
  context.closePath();
  context.clip();
  context.setTransform(scaleX, scaleY, skewX, skewY, translateX, translateY);
  context.drawImage(image, 0, 0);
  context.restore();
}

function drawFaceMesh(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  sourceLandmarks: FacePoint[],
  liveLandmarks: FacePoint[],
  triangles: [number, number, number][],
  metrics: TrackingMetrics,
) {
  if (sourceLandmarks.length < 400 || liveLandmarks.length < 400 || triangles.length === 0) return;
  const liveFace = liveLandmarks.filter((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
  if (liveFace.length < 400) return;
  const minX = Math.min(...liveFace.map((point) => point.x));
  const maxX = Math.max(...liveFace.map((point) => point.x));
  const minY = Math.min(...liveFace.map((point) => point.y));
  const maxY = Math.max(...liveFace.map((point) => point.y));
  if (maxX - minX < 0.01 || maxY - minY < 0.01) return;

  const sourcePoints = sourceLandmarks.map((point) => ({
    x: point.x * image.naturalWidth,
    y: point.y * image.naturalHeight,
    z: point.z,
  }));
  const scaleX = 1 - Math.min(25, Math.abs(metrics.yaw)) * 0.006;
  const angle = (metrics.roll * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const targetPoints = liveLandmarks.map((point) => {
    const x = ((point.x - minX) / (maxX - minX) - 0.5) * 224;
    const y = ((point.y - minY) / (maxY - minY) - 0.5) * 264;
    return {
      x: 256 - metrics.yaw * 0.7 + x * scaleX * cosine - y * sine,
      y: 205 + metrics.pitch * 0.5 + x * scaleX * sine + y * cosine,
      z: point.z,
    };
  });
  for (const [first, second, third] of triangles) {
    const sourceA = sourcePoints[first];
    const sourceB = sourcePoints[second];
    const sourceC = sourcePoints[third];
    const targetA = targetPoints[first];
    const targetB = targetPoints[second];
    const targetC = targetPoints[third];
    if (sourceA && sourceB && sourceC && targetA && targetB && targetC) {
      drawTexturedTriangle(context, image, [sourceA, sourceB, sourceC], [targetA, targetB, targetC]);
    }
  }
}

function drawAvatar(
  context: CanvasRenderingContext2D,
  avatar: AvatarId,
  metrics: TrackingMetrics,
  tracking: boolean,
  image: HTMLImageElement | null,
  sourceFaceLandmarks: FacePoint[],
  faceMeshTriangles: [number, number, number][],
  background: BackgroundPreset,
  backgroundImage: HTMLImageElement | null,
) {
  const { width, height } = context.canvas;
  const palette = palettes[avatar === 'sol' || avatar === 'milo' ? avatar : 'aria'];
  context.clearRect(0, 0, width, height);
  drawBackground(context, background, backgroundImage);
  context.fillStyle = 'rgba(255,255,255,.38)';
  context.beginPath();
  context.arc(256, 200, 154, 0, Math.PI * 2);
  context.fill();

  context.save();
  context.translate(256 - metrics.yaw * 0.7, 205 + metrics.pitch * 0.5);
  context.rotate((metrics.roll * Math.PI) / 180);
  context.scale(1 - Math.min(25, Math.abs(metrics.yaw)) * 0.006, 1);
  context.translate(-256, -205);
  context.fillStyle = palette.shirt;
  context.beginPath();
  context.moveTo(82, 410);
  context.quadraticCurveTo(100, 286, 256, 286);
  context.quadraticCurveTo(414, 286, 430, 410);
  context.fill();

  if (avatar === 'custom' && image?.complete && image.naturalWidth > 0) {
    context.save();
    context.beginPath();
    context.ellipse(256, 186, 120, 144, 0, 0, Math.PI * 2);
    context.clip();
    const scale = Math.max(240 / image.naturalWidth, 288 / image.naturalHeight);
    const sourceWidth = 240 / scale;
    const sourceHeight = 288 / scale;
    context.drawImage(
      image,
      (image.naturalWidth - sourceWidth) / 2,
      (image.naturalHeight - sourceHeight) / 2,
      sourceWidth,
      sourceHeight,
      136,
      42,
      240,
      288,
    );
    context.restore();
  } else {
    context.fillStyle = palette.skin;
    context.fillRect(214, 271, 84, 55);
    context.beginPath();
    context.ellipse(256, 183, 114, 132, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = palette.hair;
    context.beginPath();
    context.moveTo(143, 180);
    context.bezierCurveTo(115, 64, 170, 35, 254, 35);
    context.bezierCurveTo(347, 34, 385, 88, 366, 173);
    context.bezierCurveTo(330, 145, 309, 116, 299, 83);
    context.bezierCurveTo(251, 121, 205, 137, 143, 132);
    context.closePath();
    context.fill();

    const eyebrowY = 164 - metrics.browRaise * 22;
    context.strokeStyle = '#61453c';
    context.lineWidth = 10;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(184, eyebrowY);
    context.quadraticCurveTo(206, eyebrowY - 12, 226, eyebrowY);
    context.moveTo(286, eyebrowY);
    context.quadraticCurveTo(308, eyebrowY - 12, 328, eyebrowY);
    context.stroke();

    for (const [x, blink] of [[207, metrics.blinkLeft], [305, metrics.blinkRight]]) {
      const eyeHeight = 21 * Math.max(0.08, 1 - blink);
      context.fillStyle = '#fff';
      context.beginPath();
      context.ellipse(x, 191, 14, eyeHeight, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#354a50';
      context.beginPath();
      context.ellipse(x, 192, 7, eyeHeight * 0.62, 0, 0, Math.PI * 2);
      context.fill();
    }

    context.strokeStyle = '#bd8067';
    context.lineWidth = 7;
    context.beginPath();
    context.moveTo(256, 191);
    context.quadraticCurveTo(242, 222, 261, 226);
    context.stroke();
    context.fillStyle = '#803f45';
    context.beginPath();
    context.ellipse(256, 252, 25, 5 + metrics.mouthOpen * 31, 0, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();

  if (avatar === 'custom' && tracking && image?.complete && sourceFaceLandmarks.length > 0) {
    drawFaceMesh(context, image, sourceFaceLandmarks, metrics.landmarks, faceMeshTriangles, metrics);
  }

  if (avatar === 'custom') {
    context.fillStyle = '#173b47';
    context.beginPath();
    context.roundRect(12, 12, 238, 36, 18);
    context.fill();
    context.fillStyle = '#fff';
    context.font = '700 17px Segoe UI, sans-serif';
    context.textAlign = 'left';
    context.fillText('AI-GENERATED AVATAR', 26, 36);
  }
  if (!tracking) {
    context.fillStyle = '#53646b';
    context.font = '16px Segoe UI, sans-serif';
    context.textAlign = 'center';
    context.fillText('Waiting for face tracking', 256, 401);
  }
}

export function ThreeAvatarCanvas({
  metrics,
  tracking,
  avatar,
  customImageUrl = null,
  sourceFaceLandmarks = [],
  faceMeshTriangles = [],
  templateError = null,
  background = 'scene',
  backgroundImageUrl = null,
}: ThreeAvatarCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const metricsRef = useRef(metrics);
  const trackingRef = useRef(tracking);
  const avatarRef = useRef(avatar);
  const backgroundRef = useRef(background);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  const sourceFaceLandmarksRef = useRef(sourceFaceLandmarks);
  const faceMeshTrianglesRef = useRef(faceMeshTriangles);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => { metricsRef.current = metrics; }, [metrics]);
  useEffect(() => { trackingRef.current = tracking; }, [tracking]);
  useEffect(() => { avatarRef.current = avatar; }, [avatar]);
  useEffect(() => { backgroundRef.current = background; }, [background]);
  useEffect(() => { sourceFaceLandmarksRef.current = sourceFaceLandmarks; }, [sourceFaceLandmarks]);
  useEffect(() => { faceMeshTrianglesRef.current = faceMeshTriangles; }, [faceMeshTriangles]);

  useEffect(() => {
    backgroundImageRef.current = null;
    if (!backgroundImageUrl) return;
    const image = new Image();
    image.onload = () => { backgroundImageRef.current = image; };
    image.onerror = () => setRenderError('The selected background picture could not be rendered.');
    image.src = backgroundImageUrl;
    return () => {
      image.onload = null;
      image.onerror = null;
      backgroundImageRef.current = null;
    };
  }, [backgroundImageUrl]);

  useEffect(() => {
    imageRef.current = null;
    if (!customImageUrl) return;
    const image = new Image();
    image.onload = () => { imageRef.current = image; };
    image.onerror = () => setRenderError('The selected picture could not be rendered.');
    image.src = customImageUrl;
    return () => {
      image.onload = null;
      image.onerror = null;
      imageRef.current = null;
    };
  }, [customImageUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let active = true;
    let animationFrame = 0;
    let lastFrameAt = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let texture: THREE.CanvasTexture | null = null;
    let geometry: THREE.PlaneGeometry | null = null;
    let material: THREE.MeshBasicMaterial | null = null;

    try {
      const drawCanvas = document.createElement('canvas');
      drawCanvas.width = 512;
      drawCanvas.height = 410;
      const context = drawCanvas.getContext('2d');
      if (!context) throw new Error('The avatar drawing canvas is unavailable.');

      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(512, 410, false);
      renderer.setClearColor('#d7e8e4', 1);

      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1.25, 1.25, 1, -1, 0.1, 10);
      camera.position.z = 3;
      geometry = new THREE.PlaneGeometry(2.5, 2);
      texture = new THREE.CanvasTexture(drawCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      material = new THREE.MeshBasicMaterial({ map: texture });
      const head = new THREE.Mesh(geometry, material);
      scene.add(head);

      const render = (now: number) => {
        if (!active) return;
        if (now - lastFrameAt >= 1000 / 30) {
          const currentMetrics = metricsRef.current;
          drawAvatar(
            context,
            avatarRef.current,
            currentMetrics,
            trackingRef.current,
            imageRef.current,
            sourceFaceLandmarksRef.current,
            faceMeshTrianglesRef.current,
            backgroundRef.current,
            backgroundImageRef.current,
          );
          texture!.needsUpdate = true;
          head.rotation.set(
            (currentMetrics.pitch * Math.PI) / 180 * 0.45,
            (currentMetrics.yaw * Math.PI) / 180 * 0.45,
            (-currentMetrics.roll * Math.PI) / 180 * 0.45,
          );
          renderer!.render(scene, camera);
          lastFrameAt = now;
        }
        animationFrame = requestAnimationFrame(render);
      };
      setRenderError(null);
      animationFrame = requestAnimationFrame(render);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Three.js could not start.';
      setRenderError(message);
    }

    return () => {
      active = false;
      cancelAnimationFrame(animationFrame);
      texture?.dispose();
      material?.dispose();
      geometry?.dispose();
      renderer?.dispose();
    };
  }, []);

  if (renderError) {
    return (
      <div className="relative h-full w-full">
        <AvatarPreview avatar={avatar} customImageUrl={customImageUrl} metrics={metrics} tracking={tracking} />
        <p role="alert" className="absolute inset-x-2 bottom-2 rounded bg-white/90 p-1 text-center text-xs text-bad">{renderError}</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={avatar === 'custom' ? 'AI-generated animated avatar preview' : tracking ? 'Three.js animated avatar preview' : 'Three.js avatar preview waiting for face tracking'}
        className="block h-full w-full"
      />
      {avatar === 'custom' && (
        <div className="absolute left-2 top-2 rounded-full bg-slate9 px-3 py-1 text-xs font-bold tracking-wide text-white">
          AI-GENERATED
        </div>
      )}
      {avatar === 'custom' && tracking && templateError && (
        <p role="status" className="absolute inset-x-2 bottom-2 rounded bg-white/95 p-2 text-center text-xs text-warn">
          Could not map this image’s face. Showing the consented photo with head movement only.
        </p>
      )}
    </div>
  );
}
