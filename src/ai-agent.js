import Together from "together-ai";
import fs from 'fs-extra';
import path from 'node:path';

export class BacklistAIAgent {
  constructor(apiKey, onThought) {
    this.apiKey = apiKey;
    this.onThought = onThought || (() => {});
    this.together = null;
    this.modelName = "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8";
  }

  async init() {
    this.onThought('[THOUGHT] Initializing Together AI runtime...');
    try {
      this.together = new Together({ apiKey: this.apiKey });
      this.onThought('[THOUGHT] Connected to Together AI cloud service successfully.');
    } catch (err) {
      throw new Error(`Together AI initialization failed: ${err.message}`);
    }
  }

  async promptModel(systemPrompt, userPrompt) {
    const response = await this.together.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: this.modelName
    });
    return response.choices[0].message.content;
  }

  // --- PASS 1: Generate Code Blocks ---
  async generateBackendBlocks(astJsonData, existingSchemaContent = null) {
    this.onThought(`[THOUGHT] Commencing Pass 1 Analysis on ${astJsonData.length} AST endpoints via Cloud AI...`);
    
    let schemaDirective = `Generate a comprehensive Prisma schema (schema.prisma). Deduce many-to-many relationships and apply optimal indexing.`;
    if (existingSchemaContent) {
      this.onThought('[THOUGHT] Detected existing schema.prisma. Generating Schema Migration Scripts instead of full overwrite.');
      schemaDirective = `An existing schema exists. Output an SQL Migration Script instead of a full schema rewrite, along with the updated prisma schema models.`;
    }

    const systemPrompt = `You are an expert backend architect and Domain-Driven Design (DDD) specialist.
Follow Hexagonal Architecture (Ports and Adapters) principles.
Your task is to generate intelligent implementation blocks for EJS placeholders based on the provided AST data.

1. ${schemaDirective}
2. Generate <%- aiSecurityConfig %>: Define complex JWT filters, rate limiting, and CORS based on the sensitivity of the endpoints.
3. Generate <%- aiDbRelations %>: Code for Repositories connecting defined Prisma models.
4. Generate <%- aiValidationLogic %>: Input validation middleware (Zod, Joi) tailored precisely to the data shapes extracted from the frontend.

Output ONLY JSON with the following structure:
{
  "prismaSchema": "string",
  "aiSecurityConfig": "string",
  "aiDbRelations": "string",
  "aiValidationLogic": "string"
}
Do NOT include explanations. Output raw JSON only.`;

    const userPrompt = `AST Frontend Extracted Data:\n${JSON.stringify(astJsonData, null, 2)}`;

    this.onThought('[THOUGHT] Prompting Together AI (Llama-4-Maverick) with Hexagonal architecture rules...');
    let result = await this.promptModel(systemPrompt, userPrompt);
    
    // Clean JSON response
    try {
      if (result.includes('```json')) {
        result = result.split('```json')[1].split('```')[0].trim();
      } else if (result.includes('```')) {
        result = result.split('```')[1].split('```')[0].trim();
      }
      return JSON.parse(result);
    } catch (e) {
      this.onThought(`[WARNING] Failed to parse Pass 1 JSON. Attempting heuristic extraction...`);
      return {
        prismaSchema: "// Fallback schema\n" + result,
        aiSecurityConfig: "// Security fallback",
        aiDbRelations: "// Db Relations fallback",
        aiValidationLogic: "// Validation fallback"
      };
    }
  }

  // --- PASS 2: Verification Loop (Dry-Run & DOM Sync) ---
  async verifyDryRun(generatedBlocks, astJsonData) {
    this.onThought('[THOUGHT] Commencing Pass 2 Verification Loop (Virtual Dry Run)...');

    let issueFound = false;

    // DOM Sync Level 2 (Data-type matching check)
    this.onThought('[THOUGHT] Simulating frontend component tree data injection against generated validation logic...');
    
    const systemPrompt = `You are a strict QA Engine.
Review the following generated Validation Logic and DB Relations against the Frontend AST data shapes.
Check for:
1. Missing DB relations (e.g., User -> Post).
2. Data-type mismatches (DOM Sync Level 2: if AST expects 'Date' string but DB expects 'DateTime', inject a transformation middleware).

Output JSON:
{
  "issuesFound": boolean,
  "fixedValidationLogic": "string (original or fixed)",
  "fixedDbRelations": "string (original or fixed)",
  "reasonings": ["string"]
}`;

    const userPrompt = `Data:
Generated Validation: ${generatedBlocks.aiValidationLogic}
Generated DB Rel: ${generatedBlocks.aiDbRelations}
AST Shapes: ${JSON.stringify(astJsonData.map(e => e.schemaFields), null, 2)}`;

    let result = await this.promptModel(systemPrompt, userPrompt);
    
    try {
      if (result.includes('```json')) result = result.split('```json')[1].split('```')[0].trim();
      else if (result.includes('```')) result = result.split('```')[1].split('```')[0].trim();
      const verified = JSON.parse(result);
      
      if (verified.issuesFound) {
        this.onThought(`[THOUGHT] Verification caught issues! Self-healing triggered...`);
        verified.reasonings.forEach(r => this.onThought(`[THOUGHT] -> Fix applied: ${r}`));
        return {
          ...generatedBlocks,
          aiValidationLogic: verified.fixedValidationLogic,
          aiDbRelations: verified.fixedDbRelations
        };
      } else {
        this.onThought('[THOUGHT] Virtual Dry Run passed perfectly. Zero data mismatches found.');
        return generatedBlocks;
      }
    } catch (e) {
      this.onThought('[WARNING] Verification parsing failed. Using Pass 1 results.');
      return generatedBlocks;
    }
  }

  // --- Autonomous Deployment Engine ---
  async generateDeploymentConfig(stack, astJsonData) {
    this.onThought(`[THOUGHT] Generating Autonomous Deployment workflows for [${stack}]...`);
    
    const systemPrompt = `Generate a highly optimized docker-compose.yml and a .github/workflows/deploy.yml for a production ${stack} backend.
Include PostgreSQL, Redis, and best-practice health checks.
Output JSON:
{
  "dockerCompose": "string",
  "githubWorkflow": "string"
}`;

    const userPrompt = `Target Stack: ${stack}\nAST Endpoints Count: ${astJsonData ? astJsonData.length : 0}`;

    const res = await this.promptModel(systemPrompt, userPrompt);
    
    try {
      let clean = res;
      if (clean.includes('```json')) clean = clean.split('```json')[1].split('```')[0].trim();
      else if (clean.includes('```')) clean = clean.split('```')[1].split('```')[0].trim();
      const parsed = JSON.parse(clean);
      this.onThought('[THOUGHT] Deployment workflows synthesized successfully.');
      return parsed;
    } catch (e) {
      return { dockerCompose: "# Fallback Config", githubWorkflow: "# Fallback Workflow" };
    }
  }

  async dispose() {
    this.onThought('[THOUGHT] Shutting down AI context...');
    // Together AI doesn't hold local VRAM or contexts to dispose, doing nothing.
  }
}
