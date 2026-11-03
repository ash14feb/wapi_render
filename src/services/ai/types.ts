export interface AiSalesPlaybook {
  valueProposition: string;
  keyBenefits: string[];
  differentiators: string[];
  objections: Array<{ objection: string; response: string }>;
  closingGuidance: string;
}

export interface AiDiscountPolicy {
  maxDiscountPercent: number;
  allowGenericDiscounts: boolean;
  requireHumanApprovalAbove: number;
  currency: string;
  notes: string;
}

export interface AiRuntimeConfig {
  tenantId: string;
  providerBaseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  requestTimeoutMs: number;
  maxRetries: number;
  historyWindow: number;
  systemPrompt: string;
  businessInfo: string | null;
  language: string;
  tone: string;
  humanLike: boolean;
  replyDelayMs: number;
  salesPlaybook: AiSalesPlaybook | null;
  discountPolicy: AiDiscountPolicy | null;
  handoffEnabled: boolean;
  handoffInstructions: string | null;
  fallbackMessage: string | null;
}

export interface AiParsedReply {
  reply: string;
  handoff: boolean;
  handoffReason: string | null;
  intent: string | null;
  offerCode: string | null;
  discountPercent: number | null;
  memory: Record<string, string | null>;
}

export interface AiPolicyResult {
  violation: boolean;
  requireHandoff: boolean;
  code: string | null;
  message: string | null;
}

export interface KnowledgeLike {
  title: string;
  content: string;
  category: string | null;
}

export interface OfferLike {
  name: string;
  code: string | null;
  description: string | null;
  discountType: string;
  discountValue: number;
  minOrderValue: number | null;
  maxDiscountValue: number | null;
  validFrom: Date | null;
  validTo: Date | null;
}

export interface ConversationMemory {
  summary: string | null;
  facts: Record<string, string | null>;
}
