"use client";
import React, { createContext, useContext, ReactNode } from "react";

interface FallbackContextType {
  fetchWithFallback: (url: string, options?: RequestInit) => Promise<Response>;
}

const FallbackContext = createContext<FallbackContextType | null>(null);

export function FallbackProvider({ children }: { children: ReactNode }) {
  // Transparent pass-through fetch: provider failover is handled automatically on the server
  const fetchWithFallback = async (url: string, options?: RequestInit): Promise<Response> => {
    const fetchOptions = { credentials: 'include' as RequestCredentials, ...options };
    return fetch(url, fetchOptions);
  };

  return (
    <FallbackContext.Provider value={{ fetchWithFallback }}>
      {children}
    </FallbackContext.Provider>
  );
}

export function useFallbackFetch() {
  const ctx = useContext(FallbackContext);
  if (!ctx) {
    return (url: string, options?: RequestInit) => fetch(url, { credentials: 'include', ...options });
  }
  return ctx.fetchWithFallback;
}
