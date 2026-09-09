import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  ForgotPasswordInput,
  LoginInput,
  ResetPasswordInput,
  SessionResponse,
  SetupStatus,
} from "@shared/api";
import { apiGet, clearCsrfToken, csrfDelete, csrfPost, setCsrfToken } from "./api";

/**
 * Who the caller is, according to the server.
 *
 * v1 asked `/user`, which returned `{ isAdmin: true }` for everyone whenever
 * NODE_ENV was not "production" — so a plain `node server` handed the admin UI
 * to any visitor. Nothing here is inferred client-side: admin status is
 * whatever the session endpoint says, and the API re-checks it on every route
 * regardless of what this hook believes.
 */
export const sessionQueryKey = ["session"] as const;
export const setupStatusQueryKey = ["setup-status"] as const;

async function fetchSession(signal?: AbortSignal): Promise<SessionResponse> {
  const session = await apiGet<SessionResponse>("/session", signal);
  // Keep the write path's token in step with the session it belongs to.
  setCsrfToken(session.csrfToken);
  return session;
}

export function useSession(): UseQueryResult<SessionResponse> {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: ({ signal }) => fetchSession(signal),
    staleTime: 30_000,
    retry: false,
  });
}

export function useSetupStatus(): UseQueryResult<SetupStatus> {
  return useQuery({
    queryKey: setupStatusQueryKey,
    queryFn: ({ signal }) => apiGet<SetupStatus>("/setup", signal),
    staleTime: 30_000,
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: LoginInput) => csrfPost<SessionResponse>("/session", input),
    onSuccess: (session) => {
      // The server regenerates the session on login, so the old token is dead.
      setCsrfToken(session.csrfToken);
      queryClient.setQueryData(sessionQueryKey, session);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => csrfDelete<void>("/session"),
    onSuccess: async () => {
      clearCsrfToken();
      // Drop every cached admin read, not just the session: some of it is
      // catalogue data this browser is no longer entitled to.
      queryClient.clear();
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    },
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (input: ForgotPasswordInput) => csrfPost<void>("/session/forgot-password", input),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: ResetPasswordInput) => csrfPost<void>("/session/reset-password", input),
  });
}
