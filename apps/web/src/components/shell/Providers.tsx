"use client";
// App-wide client providers: theme (dark default, ADR-003), density, toasts, TanStack Query, gateway socket.
import { DensityProvider, ThemeProvider, Toaster, TooltipProvider } from "@hapiecoin/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { GatewayProvider } from "@/lib/gateway/hooks";
import { Assistant } from "@/components/shell/Assistant";
import { Tour } from "@/components/shell/Tour";
import { ApiError } from "@/lib/api/client";

export interface ProvidersProps {
  children: ReactNode;
  gatewayUrl: string;
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, err) => !(err instanceof ApiError && (err.status === 401 || err.status === 404)) && count < 2,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
    },
  });
}

export function Providers({ children, gatewayUrl }: ProvidersProps) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <ThemeProvider defaultTheme="dark">
      <DensityProvider>
        <QueryClientProvider client={queryClient}>
          <GatewayProvider url={gatewayUrl}>
            <TooltipProvider>
              {children}
              <Assistant />
              <Tour />
            </TooltipProvider>
          </GatewayProvider>
        </QueryClientProvider>
        <Toaster />
      </DensityProvider>
    </ThemeProvider>
  );
}
