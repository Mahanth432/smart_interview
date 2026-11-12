import React from 'react'

interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: string
  size?: number
  className?: string
}

const Icon = ({ name, size = 20, className = '', ...props }: IconProps) => {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', className }

  switch (name) {
    case 'smart_toy':
      return (
        <svg {...common} {...props}>
          <rect x="4" y="7" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <rect x="8" y="3" width="8" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <circle cx="9" cy="12" r="1" fill="currentColor" />
          <circle cx="15" cy="12" r="1" fill="currentColor" />
        </svg>
      )
    case 'search':
      return (
        <svg {...common} {...props}>
          <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm8.5 16.5L16 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'menu_open':
    case 'menu':
      return (
        <svg {...common} {...props}>
          <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'notifications':
    case 'notification':
      return (
        <svg {...common} {...props}>
          <path d="M15 17H9a3 3 0 0 1-3-3V11a6 6 0 1 1 12 0v3a3 3 0 0 1-3 3z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'logout':
      return (
        <svg {...common} {...props}>
          <path d="M16 17l5-5-5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M21 12H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13 19H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'dashboard':
      return (
        <svg {...common} {...props}>
          <rect x="3" y="3" width="8" height="8" stroke="currentColor" strokeWidth="1.5" rx="1" />
          <rect x="13" y="3" width="8" height="4" stroke="currentColor" strokeWidth="1.5" rx="1" />
          <rect x="13" y="9" width="8" height="11" stroke="currentColor" strokeWidth="1.5" rx="1" />
          <rect x="3" y="13" width="8" height="5" stroke="currentColor" strokeWidth="1.5" rx="1" />
        </svg>
      )
    case 'analytics':
    case 'trending_up':
      return (
        <svg {...common} {...props}>
          <path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M17 7l-5 5-3-3-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'check_circle':
      return (
        <svg {...common} {...props}>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'record_voice_over':
    case 'mic':
      return (
        <svg {...common} {...props}>
          <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M19 11a7 7 0 0 1-14 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'memory':
      return (
        <svg {...common} {...props}>
          <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9 3v3M15 3v3M9 18v3M15 18v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'download':
      return (
        <svg {...common} {...props}>
          <path d="M12 3v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M8 11l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M21 21H3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'add':
      return (
        <svg {...common} {...props}>
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'person':
    case 'person_add':
      return (
        <svg {...common} {...props}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )
    case 'lightbulb':
      return (
        <svg {...common} {...props}>
          <path d="M9 18h6M10 10a2 2 0 1 1 4 0c0 2-2 3-2 3s-2-1-2-3z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M7 13a7 7 0 1 1 10 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )
    case 'description':
      return (
        <svg {...common} {...props}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )
    case 'settings':
      return (
        <svg {...common} {...props}>
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06A2 2 0 0 1 4.27 18.9l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 0 1 5.73 4.27l.06.06c.5.5 1.18.68 1.82.33.57-.3 1.2-.3 1.7 0l.06.03A1.65 1.65 0 0 0 11 6.1V6a2 2 0 0 1 4 0v.1c.5.18 1.07.04 1.46-.27l.06-.04c.5-.3 1.13-.3 1.7 0 .64.35 1.32.17 1.82-.33l.06-.06A2 2 0 0 1 19.73 5.27l-.06.06c-.5.5-.68 1.18-.33 1.82.3.57.3 1.2 0 1.7l-.03.06c-.18.5-.04 1.07.27 1.46.31.5.31 1.13 0 1.7z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )
    case 'more_vert':
      return (
        <svg {...common} {...props}>
          <circle cx="12" cy="6" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="18" r="1.5" fill="currentColor" />
        </svg>
      )
    case 'visibility':
      return (
        <svg {...common} {...props}>
          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      )
    case 'visibility_off':
      return (
        <svg {...common} {...props}>
          <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a17.73 17.73 0 0 1 5.5-6.11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M1 1l22 22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )
    case 'thumb_up':
      return (
        <svg {...common} {...props}>
          <path d="M14 9V5a3 3 0 0 0-6 0v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M7 22h10l2-7V11a2 2 0 0 0-2-2h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'thumb_down':
      return (
        <svg {...common} {...props}>
          <path d="M10 15v4a3 3 0 0 0 6 0v-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M17 2H7l-2 7v4a2 2 0 0 0 2 2h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'error':
      return (
        <svg {...common} {...props}>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'warning':
      return (
        <svg {...common} {...props}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'info':
      return (
        <svg {...common} {...props}>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <path d="M11 10h2M11 14h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'filter_list':
      return (
        <svg {...common} {...props}>
          <path d="M3 6h18M6 12h12M10 18h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'edit':
      return (
        <svg {...common} {...props}>
          <path d="M3 21l3-1 11-11 1-3-3 1-11 11-1 3z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 7l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'print':
      return (
        <svg {...common} {...props}>
          <rect x="6" y="3" width="12" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <path d="M6 9v6h12V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 15v6h6v-6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'send':
      return (
        <svg {...common} {...props}>
          <path d="M22 2L11 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'play_arrow':
      return (
        <svg {...common} {...props}>
          <path d="M5 3v18l15-9L5 3z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'stop_circle':
      return (
        <svg {...common} {...props}>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <rect x="9" y="9" width="6" height="6" fill="currentColor" />
        </svg>
      )
    case 'refresh':
      return (
        <svg {...common} {...props}>
          <path d="M21 12a9 9 0 1 0-3 6.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M21 12v-4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'chevron_right':
      return (
        <svg {...common} {...props}>
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      )
    case 'chevron_left':
    case 'navigate_before':
      return (
        <svg {...common} {...props}>
          <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      )
    case 'arrow_back':
      return (
        <svg {...common} {...props}>
          <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'arrow_forward':
      return (
        <svg {...common} {...props}>
          <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'close':
      return (
        <svg {...common} {...props}>
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'check':
      return (
        <svg {...common} {...props}>
          <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'library_books':
      return (
        <svg {...common} {...props}>
          <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'cloud_download':
      return (
        <svg {...common} {...props}>
          <path d="M7 16a4 4 0 0 1-.88-7.9A5.5 5.5 0 0 1 17 9a3.5 3.5 0 0 1 .5 6.96" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 12v8m0 0l-3-3m3 3l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'cloud_upload':
    case 'upload':
      return (
        <svg {...common} {...props}>
          <path d="M7 16a4 4 0 0 1-.88-7.9A5.5 5.5 0 0 1 17 9a3.5 3.5 0 0 1 .5 6.96" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 20v-8m0 0l-3 3m3-3l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'sync':
      return (
        <svg {...common} {...props}>
          <path d="M20 7v4h-4M4 17v-4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5.6 9A7 7 0 0 1 19 8l1 3M18.4 15A7 7 0 0 1 5 16l-1-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'delete':
      return (
        <svg {...common} {...props}>
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M9 7V4h6v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'lock':
      return (
        <svg {...common} {...props}>
          <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'link':
      return (
        <svg {...common} {...props}>
          <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4.93" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 19.07" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'calendar_today':
      return (
        <svg {...common} {...props}>
          <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M16 3v4M8 3v4M3 10h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'save':
      return (
        <svg {...common} {...props}>
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M17 21v-8H7v8M7 3v5h8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )
    case 'tune':
    case 'settings_suggest':
      return (
        <svg {...common} {...props}>
          <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="9" cy="6" r="2" fill="currentColor" />
          <circle cx="15" cy="12" r="2" fill="currentColor" />
          <circle cx="8" cy="18" r="2" fill="currentColor" />
        </svg>
      )
    case 'hub':
      return (
        <svg {...common} {...props}>
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="5" cy="6" r="2" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="19" cy="6" r="2" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="12" cy="20" r="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9.6 10.2L6.6 7.5M14.4 10.2l3-2.7M12 15v3" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      )
    case 'bolt':
      return (
        <svg {...common} {...props}>
          <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )
    case 'swap_horiz':
      return (
        <svg {...common} {...props}>
          <path d="M17 4l4 4-4 4M21 8H7M7 20l-4-4 4-4M3 16h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'verified_user':
    case 'security':
      return (
        <svg {...common} {...props}>
          <path d="M12 3l7 3v6c0 4.5-3 8.2-7 9.5C8 20.2 5 16.5 5 12V6l7-3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'search_off':
      return (
        <svg {...common} {...props}>
          <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M20 20l-4.5-4.5M8 8l5 5M13 8l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'history':
      return (
        <svg {...common} {...props}>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'people':
    case 'group':
      return (
        <svg {...common} {...props}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="9" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M22 21v-2a3.5 3.5 0 0 0-2.5-3.3M16.5 4.2a3.5 3.5 0 0 1 0 6.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'person_search':
      return (
        <svg {...common} {...props}>
          <circle cx="9" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 20v-1.5a4.5 4.5 0 0 1 4.5-4.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="16.5" cy="16.5" r="3" stroke="currentColor" strokeWidth="1.5" />
          <path d="M21 21l-2.2-2.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'person_off':
      return (
        <svg {...common} {...props}>
          <circle cx="12" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 20a7 7 0 0 1 14 0M3 3l18 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'question_answer':
      return (
        <svg {...common} {...props}>
          <path d="M4 5h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M18 9h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v3l-3-3h-4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )
    case 'help_outline':
      return (
        <svg {...common} {...props}>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9.5 9a2.5 2.5 0 0 1 5 .8c0 1.7-2.5 2.2-2.5 3.7M12 17h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )
    case 'speed':
      return (
        <svg {...common} {...props}>
          <path d="M4 17a9 9 0 1 1 16 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M12 14l4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="12" cy="15" r="1.5" fill="currentColor" />
        </svg>
      )
    case 'hourglass_top':
      return (
        <svg {...common} {...props}>
          <path d="M6 3h12M6 21h12M8 3v4l4 4 4-4V3M8 21v-4l4-4 4 4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'rate_review':
      return (
        <svg {...common} {...props}>
          <path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M8 10h8M8 13h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'psychology':
      return (
        <svg {...common} {...props}>
          <path d="M9 19v-2a3 3 0 0 1-3-3 4 4 0 0 1 1-7.5A4.5 4.5 0 0 1 16 5a4 4 0 0 1 2 7.4V15a2 2 0 0 1-2 2h-1v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="10" r="2" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      )
    case 'assignment':
      return (
        <svg {...common} {...props}>
          <rect x="5" y="4" width="14" height="17" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'emoji_events':
      return (
        <svg {...common} {...props}>
          <path d="M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'error_outline':
      return (
        <svg {...common} {...props}>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 8v5M12 16.5h.01" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      )
    case 'inbox':
      return (
        <svg {...common} {...props}>
          <path d="M4 13l2-8h12l2 8v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M4 13h5l1.5 2h3L15 13h5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )
    case 'list':
      return (
        <svg {...common} {...props}>
          <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      )
    case 'pause':
      return (
        <svg {...common} {...props}>
          <rect x="6" y="4" width="4" height="16" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="14" y="4" width="4" height="16" rx="1" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )
    case 'dark_mode':
      return (
        <svg {...common} {...props}>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'light_mode':
      return (
        <svg {...common} {...props}>
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'navigate_next':
      return (
        <svg {...common} {...props}>
          <path d="M8 5l8 7-8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      )
    default:
      // Generic square placeholder (keeps layout intact)
      return (
        <svg {...common} {...props}>
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      )
  }
}

export default Icon
