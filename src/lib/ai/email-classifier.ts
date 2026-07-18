import { z } from "zod";
import { generateJSON } from "@/lib/ai/gemini";
import type { MessageClassification } from "@prisma/client";

/**
 * Inbound Email Classifier — fast model, minimal prompt.
 * Classifies replies into pipeline-relevant categories with confidence.
 */

const classificationValues = [
  "REPLY",
  "INTERVIEW_REQUEST",
  "ASSESSMENT",
  "REJECTION",
  "OFFER",
  "QUESTION",
  "FOLLOW_UP_REQUEST",
  "AUTO_REPLY",
  "OTHER",
] as const;

const resultSchema = z.object({
  classification: z.enum(classificationValues),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
});

export type ClassificationResult = {
  classification: MessageClassification;
  confidence: number;
  summary: string;
};

const PROMPT = (from: string, subject: string, body: string) => `Classify this email received in response to a job application.

Categories:
- INTERVIEW_REQUEST: invites to interview/call/meeting, or asks for availability
- ASSESSMENT: coding challenge, take-home task, or test
- OFFER: job offer or offer discussion
- REJECTION: explicit "no" / position filled / not moving forward
- QUESTION: asks the candidate something (visa, salary expectation, notice period…)
- FOLLOW_UP_REQUEST: asks for documents, portfolio, references, or more info
- AUTO_REPLY: automated acknowledgement / out-of-office / ticket confirmation
- REPLY: human reply that fits none of the above
- OTHER: unrelated to any job application

FROM: ${from}
SUBJECT: ${subject}
BODY:
"""
${body.slice(0, 6_000)}
"""

Return JSON: { "classification": "<category>", "confidence": 0.0-1.0, "summary": "<one sentence, max 20 words>" }`;

export async function classifyInboundEmail(
  userId: string,
  email: { from: string; subject: string; body: string }
): Promise<ClassificationResult> {
  const result = await generateJSON(
    PROMPT(email.from, email.subject, email.body),
    resultSchema,
    { userId, tier: "fast", temperature: 0 }
  );
  return result as ClassificationResult;
}
