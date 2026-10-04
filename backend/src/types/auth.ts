export type UserRole = "admin" | "agent";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface UserWithPasswordHash extends AuthenticatedUser {
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

export type PublicUser = Omit<UserWithPasswordHash, "password_hash">;

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}
