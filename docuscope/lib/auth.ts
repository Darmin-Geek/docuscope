// Shared user shape used across the app. Populated from the OIDC id_token claims.
export type User = {
  uid: string;
  email: string | null;
};
