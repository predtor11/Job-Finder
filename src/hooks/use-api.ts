"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { toast } from "sonner";

/** Typed fetch wrapper — throws the server's { error } message on failure. */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error ?? `Request failed (${res.status})`
    );
  }
  return data as T;
}

export function useApiQuery<T>(
  key: unknown[],
  url: string,
  options?: Omit<UseQueryOptions<T, Error>, "queryKey" | "queryFn">
) {
  return useQuery<T, Error>({
    queryKey: key,
    queryFn: () => api<T>(url),
    ...options,
  });
}

/**
 * Mutation helper: JSON request + toast feedback + query invalidation.
 * Usage: const m = useApiMutation("POST", (vars) => `/api/...`, { invalidate: [["jobs"]] })
 */
export function useApiMutation<TVars = void, TData = unknown>(
  method: "POST" | "PATCH" | "DELETE" | "PUT",
  urlFor: (vars: TVars) => string,
  options?: {
    body?: (vars: TVars) => unknown;
    invalidate?: unknown[][];
    successMessage?: string | ((data: TData) => string);
    errorToast?: boolean;
    onSuccess?: (data: TData) => void;
  }
) {
  const queryClient = useQueryClient();
  return useMutation<TData, Error, TVars>({
    mutationFn: (vars) =>
      api<TData>(urlFor(vars), {
        method,
        ...(options?.body ? { body: JSON.stringify(options.body(vars)) } : {}),
      }),
    onSuccess: (data) => {
      for (const key of options?.invalidate ?? []) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      if (options?.successMessage) {
        toast.success(
          typeof options.successMessage === "function"
            ? options.successMessage(data)
            : options.successMessage
        );
      }
      options?.onSuccess?.(data);
    },
    onError: (error) => {
      if (options?.errorToast !== false) toast.error(error.message);
    },
  });
}
