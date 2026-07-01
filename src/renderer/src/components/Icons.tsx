import type { JSX } from 'react'

interface IconProps {
  size?: number
  className?: string
}

function Stroke({
  size = 22,
  className,
  width = 1.9,
  children
}: IconProps & { width?: number; children: JSX.Element | JSX.Element[] }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

function Fill({
  size = 22,
  className,
  children
}: IconProps & { children: JSX.Element | JSX.Element[] }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const HomeIcon = (p: IconProps): JSX.Element => (
  <Stroke {...p}>
    <path d="M4 11.4 12 5l8 6.4" />
    <path d="M6 10.2V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8.8" />
  </Stroke>
)

export const SearchIcon = (p: IconProps): JSX.Element => (
  <Stroke {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </Stroke>
)

export const PlayIcon = (p: IconProps): JSX.Element => (
  <Fill {...p}>
    <path d="M8 5.3v13.4a1 1 0 0 0 1.52.85l10.6-6.7a1 1 0 0 0 0-1.7L9.52 4.45A1 1 0 0 0 8 5.3z" />
  </Fill>
)

export const PauseIcon = (p: IconProps): JSX.Element => (
  <Fill {...p}>
    <rect x="6.5" y="5" width="3.7" height="14" rx="1.3" />
    <rect x="13.8" y="5" width="3.7" height="14" rx="1.3" />
  </Fill>
)

export const PrevIcon = (p: IconProps): JSX.Element => (
  <Fill {...p}>
    <rect x="6" y="5" width="2.3" height="14" rx="1.1" />
    <path d="M20 6.2v11.6a1 1 0 0 1-1.53.85l-8.4-5.8a1 1 0 0 1 0-1.7l8.4-5.8A1 1 0 0 1 20 6.2z" />
  </Fill>
)

export const NextIcon = (p: IconProps): JSX.Element => (
  <Fill {...p}>
    <rect x="15.7" y="5" width="2.3" height="14" rx="1.1" />
    <path d="M4 6.2v11.6a1 1 0 0 0 1.53.85l8.4-5.8a1 1 0 0 0 0-1.7l-8.4-5.8A1 1 0 0 0 4 6.2z" />
  </Fill>
)

export const ShuffleIcon = (p: IconProps): JSX.Element => (
  <Stroke {...p}>
    <path d="M3 17.5h2.2c1.3 0 2.5-.65 3.25-1.75l5.1-7.5C14.3 7.15 15.5 6.5 16.8 6.5H21" />
    <path d="m17.5 3 3.5 3.5L17.5 10" />
    <path d="M3 6.5h2.2c1.3 0 2.5.65 3.25 1.75l.5.75" />
    <path d="M21 17.5h-4.2c-1.3 0-2.5-.65-3.25-1.75l-.5-.75" />
    <path d="m17.5 14 3.5 3.5L17.5 21" />
  </Stroke>
)

export const RepeatIcon = (p: IconProps): JSX.Element => (
  <Stroke {...p}>
    <path d="m16.5 2.5 3.5 3.5-3.5 3.5" />
    <path d="M3 11v-.5A4.5 4.5 0 0 1 7.5 6H20" />
    <path d="m7.5 21.5-3.5-3.5 3.5-3.5" />
    <path d="M21 13v.5a4.5 4.5 0 0 1-4.5 4.5H4" />
  </Stroke>
)

export const RepeatOneIcon = (p: IconProps): JSX.Element => (
  <Stroke {...p}>
    <path d="m16.5 2.5 3.5 3.5-3.5 3.5" />
    <path d="M3 11v-.5A4.5 4.5 0 0 1 7.5 6H20" />
    <path d="m7.5 21.5-3.5-3.5 3.5-3.5" />
    <path d="M21 13v.5a4.5 4.5 0 0 1-4.5 4.5H4" />
    <text x="12" y="14.6" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">
      1
    </text>
  </Stroke>
)

export const VolumeHighIcon = (p: IconProps): JSX.Element => (
  <Stroke {...p}>
    <path d="M11 5 6.5 9H3.5v6h3l4.5 4z" fill="currentColor" stroke="none" />
    <path d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4" />
    <path d="M18.5 6a8 8 0 0 1 0 12" />
  </Stroke>
)

export const VolumeLowIcon = (p: IconProps): JSX.Element => (
  <Stroke {...p}>
    <path d="M11 5 6.5 9H3.5v6h3l4.5 4z" fill="currentColor" stroke="none" />
    <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />
  </Stroke>
)

export const VolumeMuteIcon = (p: IconProps): JSX.Element => (
  <Stroke {...p}>
    <path d="M11 5 6.5 9H3.5v6h3l4.5 4z" fill="currentColor" stroke="none" />
    <path d="m16 9.5 5 5" />
    <path d="m21 9.5-5 5" />
  </Stroke>
)

export const FolderIcon = (p: IconProps): JSX.Element => (
  <Stroke {...p}>
    <path d="M3 7.5a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6l1.4 1.4H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Stroke>
)

export const MusicIcon = (p: IconProps): JSX.Element => (
  <Stroke {...p}>
    <path d="M9 18V6l10-2.2V15" />
    <circle cx="6.5" cy="18" r="2.5" fill="currentColor" stroke="none" />
    <circle cx="16.5" cy="15" r="2.5" fill="currentColor" stroke="none" />
  </Stroke>
)

export const HeartIcon = ({ filled, ...p }: IconProps & { filled?: boolean }): JSX.Element => (
  <Stroke {...p} width={1.8}>
    <path
      d="M12 20s-6.8-4.2-9.1-8.3C1.4 8.9 2.6 5.6 5.7 5.2 7.8 4.9 9.4 6 12 8.8c2.6-2.8 4.2-3.9 6.3-3.6 3.1.4 4.3 3.7 2.8 6.5C18.8 15.8 12 20 12 20z"
      fill={filled ? 'currentColor' : 'none'}
    />
  </Stroke>
)

export const RefreshIcon = (p: IconProps): JSX.Element => (
  <Stroke {...p}>
    <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
    <path d="M20.5 4v5h-5" />
  </Stroke>
)

export const DotsIcon = (p: IconProps): JSX.Element => (
  <Fill {...p}>
    <circle cx="5" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="19" cy="12" r="1.7" />
  </Fill>
)

export const RevealIcon = (p: IconProps): JSX.Element => (
  <Stroke {...p}>
    <path d="M13 4h7v7" />
    <path d="M20 4 10 14" />
    <path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
  </Stroke>
)

export const AlertIcon = (p: IconProps): JSX.Element => (
  <Stroke {...p} width={1.8}>
    <path d="M12 4 2.5 20.5h19z" />
    <path d="M12 10v4.5" />
    <circle cx="12" cy="17.6" r="0.7" fill="currentColor" stroke="none" />
  </Stroke>
)

export const FolderPlusIcon = (p: IconProps): JSX.Element => (
  <Stroke {...p}>
    <path d="M3 7.5a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6l1.4 1.4H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M12 11.5v4" />
    <path d="M10 13.5h4" />
  </Stroke>
)

export const GearIcon = (p: IconProps): JSX.Element => (
  <Stroke {...p} width={1.8}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </Stroke>
)

export const PanelLeftIcon = (p: IconProps): JSX.Element => (
  <Stroke {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </Stroke>
)

export const CheckIcon = (p: IconProps): JSX.Element => (
  <Stroke {...p} width={2.2}>
    <path d="M20 6 9 17l-5-5" />
  </Stroke>
)

export const CloseIcon = (p: IconProps): JSX.Element => (
  <Stroke {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Stroke>
)

export const Logo = ({ size = 26, className }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 28 28" fill="none" className={className} aria-hidden="true">
    <defs>
      <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#7c5cff" />
        <stop offset="1" stopColor="#4d8dff" />
      </linearGradient>
    </defs>
    <path
      d="M3 8.2a2.4 2.4 0 0 1 2.4-2.4h4.3a2.4 2.4 0 0 1 1.7.7l1.5 1.5h7.3A2.4 2.4 0 0 1 22.6 10v9.8a2.4 2.4 0 0 1-2.4 2.4H5.4A2.4 2.4 0 0 1 3 19.8z"
      fill="url(#lg)"
    />
    <path d="M13.4 19V11l5.2-1.1v6.4" stroke="#0b0b0f" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="11.6" cy="19" r="1.9" fill="#0b0b0f" />
    <circle cx="18.6" cy="16.3" r="1.9" fill="#0b0b0f" />
  </svg>
)
