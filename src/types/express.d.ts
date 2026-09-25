export interface AuthContext {
  userId: string;
  tenantId: string;
  role?: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
