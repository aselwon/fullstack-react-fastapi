"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Workspace } from "../components/workspace";
export default function Home() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 10000 } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Workspace />
    </QueryClientProvider>
  );
}
