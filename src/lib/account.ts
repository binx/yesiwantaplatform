import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  CustomerLoginInput,
  CustomerProfile,
  CustomerProfileUpdateInput,
  CustomerRegisterInput,
  CustomerSession,
  ForgotPasswordInput,
  MailingAddressInput,
  ResetPasswordInput,
} from "@shared/account";
import type { Order, ReceivedPostcard, Subscription } from "@shared/platform";
import type { Verification } from "@shared/postcards";
import { apiGet, clearCsrfToken, csrfDelete, csrfPost, csrfPut, setCsrfToken } from "./api";

/**
 * The signed-in person, mirroring `@/lib/session`'s admin equivalent.
 *
 * `GET /api/account` answers 200 with a null customer when nobody is signed
 * in, like the admin `/api/session`. Every other `/api/account/*` route
 * answers 401, because there it is a refusal.
 */
export const customerQueryKey = ["account"] as const;
const subscriptionsQueryKey = ["account", "subscriptions"] as const;
const postcardsQueryKey = ["account", "postcards"] as const;
const ordersQueryKey = ["account", "orders"] as const;

async function fetchCustomer(signal?: AbortSignal): Promise<CustomerProfile | null> {
  const session = await apiGet<CustomerSession>("/account", signal);
  return session.customer;
}

export function useCustomer(): UseQueryResult<CustomerProfile | null> {
  return useQuery({
    queryKey: customerQueryKey,
    queryFn: ({ signal }) => fetchCustomer(signal),
    staleTime: 30_000,
    retry: false,
  });
}

/** Both a fresh sign-in and a fresh verification hand back a new CSRF token. */
function onSignedIn(queryClient: ReturnType<typeof useQueryClient>, csrfToken: string): void {
  setCsrfToken(csrfToken);
  void queryClient.invalidateQueries({ queryKey: customerQueryKey });
}

export function useRegister() {
  return useMutation({
    mutationFn: (input: CustomerRegisterInput) => csrfPost<void>("/account/register", input),
  });
}

export function useVerifyEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => csrfPost<{ csrfToken: string }>("/account/verify", { token }),
    onSuccess: (result) => onSignedIn(queryClient, result.csrfToken),
  });
}

export function useCustomerLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerLoginInput) => csrfPost<{ csrfToken: string }>("/account/session", input),
    onSuccess: (result) => onSignedIn(queryClient, result.csrfToken),
  });
}

export function useCustomerLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => csrfDelete<void>("/account/session"),
    onSuccess: async () => {
      clearCsrfToken();
      // Everything this person could see: their account, and their studio.
      queryClient.removeQueries({ queryKey: ["account"] });
      queryClient.removeQueries({ queryKey: ["studio"] });
      await queryClient.invalidateQueries({ queryKey: customerQueryKey });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerProfileUpdateInput) => csrfPut<void>("/account", input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: customerQueryKey }),
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (input: ForgotPasswordInput) => csrfPost<void>("/account/password/forgot", input),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: ResetPasswordInput) => csrfPost<void>("/account/password/reset", input),
  });
}

/* ----------------------------------------------------------------- address */

export function useUpdateAddress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MailingAddressInput) => csrfPut<{ address: MailingAddressInput; verification: Verification }>("/account/address", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customerQueryKey });
      void queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey });
    },
  });
}

/* ----------------------------------------------------------- subscriptions */

export function useSubscriptions(enabled = true): UseQueryResult<Subscription[]> {
  return useQuery({
    queryKey: subscriptionsQueryKey,
    queryFn: ({ signal }) => apiGet<Subscription[]>("/account/subscriptions", signal),
    enabled,
  });
}

export function useCancelSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => csrfPost<void>(`/account/subscriptions/${id}/cancel`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey }),
  });
}

export function useResumeSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => csrfPost<void>(`/account/subscriptions/${id}/resume`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey }),
  });
}

/* --------------------------------------------------------------- postcards */

export function useReceivedPostcards(enabled = true): UseQueryResult<ReceivedPostcard[]> {
  return useQuery({
    queryKey: postcardsQueryKey,
    queryFn: ({ signal }) => apiGet<ReceivedPostcard[]>("/account/postcards", signal),
    enabled,
  });
}

/* ------------------------------------------------------------------ orders */

export function useCustomerOrders(enabled = true): UseQueryResult<Order[]> {
  return useQuery({
    queryKey: ordersQueryKey,
    queryFn: ({ signal }) => apiGet<Order[]>("/account/orders", signal),
    enabled,
  });
}
