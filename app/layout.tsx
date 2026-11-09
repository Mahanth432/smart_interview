import type { Metadata } from 'next'
import { Inter, Outfit } from 'next/font/google'
import './globals.css'
import './responsive.css'
import './zentra-theme.css'
import { ToastProvider } from '@/components/providers/ToastProvider'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { FallbackProvider } from '@/components/providers/FallbackProvider'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const outfit = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-outfit',
})

export const metadata: Metadata = {
  title: 'SmartInterview AI',
  description: 'Adaptive AI-powered interview platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${outfit.variable}`}>
      <head>
        {/* Blocking script: runs before React hydration to apply stored theme,
            defaulting to the clean light theme matching Zentra reference. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme') || localStorage.getItem('smartinterview-theme');
                  var isDark = theme === 'dark';
                  var cls = isDark ? 'dark-theme' : 'light-theme';
                  var remove = isDark ? 'light-theme' : 'dark-theme';
                  document.documentElement.classList.add(cls);
                  document.documentElement.classList.remove(remove);
                  /* Body may not exist yet during head parse – handle via DOMContentLoaded */
                  if (document.body) {
                    document.body.classList.add(cls);
                    document.body.classList.remove(remove);
                  } else {
                    document.addEventListener('DOMContentLoaded', function() {
                      document.body.classList.add(cls);
                      document.body.classList.remove(remove);
                    });
                  }
                } catch(e) {
                  document.documentElement.classList.add('light-theme');
                }
              })();
            `,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" />
      </head>
      <body>
        <ToastProvider>
          <ThemeProvider>
            <FallbackProvider>
              {children}
            </FallbackProvider>
          </ThemeProvider>
        </ToastProvider>
      </body>
    </html>
  )
}
