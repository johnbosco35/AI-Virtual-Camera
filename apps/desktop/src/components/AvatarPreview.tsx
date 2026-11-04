import { useId } from 'react';
import type { TrackingMetrics } from '@/hooks/useFaceTracking';
import type { AvatarId } from '@/store/appStore';

interface AvatarPreviewProps {
  metrics: TrackingMetrics;
  tracking: boolean;
  avatar?: AvatarId;
  customImageUrl?: string | null;
}

const avatarStyles = {
  aria: { skin: '#e8b99a', highlight: '#f4cba9', hair: '#283a47', shirt: '#387a78', hairPath: 'M82 103c-8-50 17-83 70-83 46 0 71 27 68 75-14-19-24-37-29-53-24 23-61 36-109 36z' },
  sol: { skin: '#c98562', highlight: '#e7aa7f', hair: '#8a552e', shirt: '#be773f', hairPath: 'M82 106c-7-55 18-88 69-88 49 0 75 29 69 83-15-9-24-25-30-45-28 25-63 39-108 38z' },
  milo: { skin: '#8c5947', highlight: '#bd8067', hair: '#242b35', shirt: '#536a9a', hairPath: 'M82 100c-6-48 18-78 69-78 48 0 72 26 70 72l-15-5-8-29c-27 21-62 32-113 32z' },
};

export function AvatarPreview({ metrics, tracking, avatar = 'aria', customImageUrl = null }: AvatarPreviewProps) {
  const instanceId = useId().replaceAll(':', '');
  const backgroundId = `avatar-background-${instanceId}`;
  const skinId = `avatar-skin-${instanceId}`;
  const cropId = `custom-avatar-crop-${instanceId}`;
  const yaw = Math.max(-25, Math.min(25, metrics.yaw));
  const pitch = Math.max(-15, Math.min(15, metrics.pitch));
  const roll = Math.max(-25, Math.min(25, metrics.roll));
  const eyeScaleLeft = Math.max(0.08, 1 - metrics.blinkLeft);
  const eyeScaleRight = Math.max(0.08, 1 - metrics.blinkRight);
  const mouthHeight = 5 + metrics.mouthOpen * 30;
  const style = avatarStyles[avatar === 'sol' || avatar === 'milo' ? avatar : 'aria'];

  return (
    <svg
      viewBox="0 0 300 240"
      role="img"
      aria-label={tracking ? 'Animated avatar preview' : 'Avatar preview waiting for face tracking'}
      className="h-full w-full"
    >
      <defs>
        <linearGradient id={backgroundId} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#e9f4f1" />
          <stop offset="1" stopColor="#d7e8e4" />
        </linearGradient>
        <linearGradient id={skinId} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor={style.highlight} />
          <stop offset="1" stopColor={style.skin} />
        </linearGradient>
        <clipPath id={cropId}>
          <ellipse cx="150" cy="111" rx="70" ry="81" />
        </clipPath>
      </defs>
      <rect width="300" height="240" fill={`url(#${backgroundId})`} />
      <circle cx="150" cy="112" r="95" fill="#ffffff" opacity=".38" />
      <g transform={`translate(${yaw * -0.35} ${pitch * 0.35}) rotate(${roll} 150 112) scale(${1 - Math.abs(yaw) * 0.003} 1) translate(${yaw * 0.35} ${pitch * -0.35})`}>
        <path d="M66 240c5-45 33-68 84-68s79 23 84 68" fill={style.shirt} />
        {customImageUrl ? (
          <image href={customImageUrl} x="78" y="28" width="144" height="166" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${cropId})`} />
        ) : (
          <>
        <path d="M126 169h48v35c-11 12-37 12-48 0z" fill={style.skin} />
        <ellipse cx="150" cy="108" rx="68" ry="78" fill={`url(#${skinId})`} />
        <path d={style.hairPath} fill={style.hair} />
        <path d="M88 94c-8 9-9 24-2 32 6 6 13 3 17-2m109-30c8 9 9 24 2 32-6 6-13 3-17-2" fill="#e2ad90" />
        <path d={`M111 ${79 - metrics.browRaise * 9}q13-8 27 0`} fill="none" stroke="#61453c" strokeWidth="5" strokeLinecap="round" />
        <path d={`M162 ${79 - metrics.browRaise * 9}q13-8 27 0`} fill="none" stroke="#61453c" strokeWidth="5" strokeLinecap="round" />
        <g transform={`translate(0 ${102 * (1 - eyeScaleLeft)}) scale(1 ${eyeScaleLeft})`}>
          <ellipse cx="124" cy="102" rx="8" ry="10" fill="#ffffff" />
          <ellipse cx="124" cy="102" rx="4" ry="6" fill="#354a50" />
        </g>
        <g transform={`translate(0 ${102 * (1 - eyeScaleRight)}) scale(1 ${eyeScaleRight})`}>
          <ellipse cx="176" cy="102" rx="8" ry="10" fill="#ffffff" />
          <ellipse cx="176" cy="102" rx="4" ry="6" fill="#354a50" />
        </g>
        <path d="M150 103q-7 21 3 23" fill="none" stroke="#bd8067" strokeWidth="4" strokeLinecap="round" />
        <ellipse cx="150" cy="145" rx="15" ry={mouthHeight / 2} fill="#803f45" />
        <path d="M139 144q11 6 22 0" fill="none" stroke="#f1b3a5" strokeWidth="2" />
          </>
        )}
      </g>
      {customImageUrl && (
        <g aria-label="AI-generated avatar">
          <rect x="101" y="200" width="98" height="22" rx="11" fill="#173b47" />
          <text x="150" y="215" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="600">AI AVATAR</text>
        </g>
      )}
      {!tracking && (
        <text x="150" y="235" textAnchor="middle" fill="#53646b" fontSize="12">
          Start camera preview to animate
        </text>
      )}
    </svg>
  );
}
