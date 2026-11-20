// Server state for the Vue app, on TanStack Query: one cache of what the Worker's /api returned, so
// panels stop each hand-writing "load, busy, error, load again". A query is keyed by what it reads;
// a change (POST, PUT, DELETE) names the keys it makes stale and they refresh when it succeeds.
// Use these for lists and records read from /api; keep component state for what a person is typing.
import { QueryClient, useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/vue-query";
import { api, ApiError } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Admin panels are read again after every change; the rest of the time a recent answer will do.
      staleTime: 15_000,
      // A kiosk shouldn't refetch whenever its window gets focus.
      refetchOnWindowFocus: false,
      // One retry for a network or server failure; never for a refusal (401, 403, 404, 422...).
      retry: (count, e) => count < 1 && !(e instanceof ApiError && e.status < 500),
    },
  },
});

/** GET a JSON resource of the Worker's /api, cached under `key`. */
export const useApiQuery = <T>(key: QueryKey, path: string) => useQuery({ queryKey: key, queryFn: () => api<T>(path) });

/**
 * A change to the server. When it succeeds, every query under the keys in `refresh` is read again.
 * `error` on the result is the server's own message (ApiError), ready to show.
 */
export function useApiMutation<V = void, R = unknown>(call: (v: V) => Promise<R>, refresh: QueryKey[]) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: call, onSuccess: () => Promise.all(refresh.map((queryKey) => qc.invalidateQueries({ queryKey }))) });
}

/** A query's or mutation's error as the words to show, or null. */
export const errorText = (...errors: unknown[]): string | null => {
  const e = errors.find(Boolean);
  return e instanceof Error ? e.message : e ? "Something went wrong." : null;
};
