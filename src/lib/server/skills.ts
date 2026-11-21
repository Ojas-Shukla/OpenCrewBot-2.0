import { randomUUID } from "node:crypto";
import type { ReusableSkill } from "@/lib/shared/types";
import { listSkills, saveSkill } from "./db";

const skillDefinitions: Omit<ReusableSkill, "id" | "createdAt" | "updatedAt">[] = [
  { name: "Market Research", category: "research", description: "Research markets, customers and industry trends.", instructions: "Define the market, find authoritative sources, compare evidence and separate verified facts from hypotheses.", outputFormat: "Executive summary, evidence table and source list", tools: ["web_search", "memory"] },
  { name: "Competitor Analysis", category: "research", description: "Compare competitors, positioning and products.", instructions: "Compare competitors by product, customer, pricing, positioning, strengths and weaknesses.", outputFormat: "Comparison matrix and opportunity analysis", tools: ["web_search", "memory"] },
  { name: "Financial Modelling", category: "analysis", description: "Build assumptions, calculations and scenario models.", instructions: "State assumptions, show calculations, identify sensitivities and avoid unsupported precision.", outputFormat: "Assumptions, calculations and recommendations", tools: ["code_mode", "memory"] },
  { name: "Presentation Creation", category: "writing", description: "Turn research and decisions into presentation-ready structure.", instructions: "Create a concise narrative, slide-by-slide outline and speaker notes.", outputFormat: "Slide outline and speaker notes", tools: ["memory"] },
  { name: "Email Drafting", category: "writing", description: "Write clear, audience-specific business email drafts.", instructions: "Use an appropriate tone, explicit objective and a concise call to action.", outputFormat: "Subject, draft and follow-up suggestion", tools: ["memory"] },
  { name: "Code Review", category: "development", description: "Review code for correctness, security and maintainability.", instructions: "Prioritize high-confidence defects, explain impact and propose precise fixes.", outputFormat: "Prioritized findings with file references", tools: ["memory", "mcp"] },
  { name: "Data Analysis", category: "analysis", description: "Analyse datasets and communicate findings.", instructions: "Describe data quality, calculations, segments and actionable findings.", outputFormat: "Method, findings, visualisation suggestions and recommendations", tools: ["code_mode", "memory"] },
  { name: "Lead Generation", category: "sales", description: "Identify and qualify potential customers or partners.", instructions: "Define ideal customer criteria, qualify evidence and keep source URLs.", outputFormat: "Qualified lead table with rationale and next actions", tools: ["web_search", "memory"] },
];

export async function seedSkills(): Promise<ReusableSkill[]> {
  const existing = await listSkills();
  if (existing.length >= 8) return existing;
  const now = new Date().toISOString();
  for (const definition of skillDefinitions) {
    const existingSkill = existing.find((skill) => skill.name === definition.name);
    if (existingSkill) continue;
    await saveSkill({
      ...definition,
      id: randomUUID().slice(0, 8),
      createdAt: now,
      updatedAt: now,
    });
  }
  return listSkills();
}
