import bcrypt from "bcryptjs";
import { jwtExpiresIn } from "../config/auth.js";
import { AppError } from "../errors/app-error.js";
import { userRepository } from "../repositories/user.repository.js";
import type { LoginInput, PublicUser, RegisterInput } from "../types/auth.js";
import { createAccessToken } from "../utils/access-token.js";

const passwordHashRounds = 12;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export const authService = {
  async register(input: RegisterInput): Promise<PublicUser> {
    const passwordHash = await bcrypt.hash(input.password, passwordHashRounds);
    try {
      return await userRepository.create({
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("An account with this email already exists", 409);
      }
      throw error;
    }
  },

  async login(input: LoginInput) {
    const user = await userRepository.findByEmail(input.email.toLowerCase());
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
      throw new AppError("Invalid email or password", 401);
    }

    const { password_hash: _passwordHash, ...publicUser } = user;
    return {
      accessToken: createAccessToken(publicUser),
      tokenType: "Bearer" as const,
      expiresIn: jwtExpiresIn,
      user: publicUser,
    };
  },
};
