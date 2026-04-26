# Healing Studio — Complete Backend Pipeline Diagrams

This document contains 8 layered Mermaid diagrams covering the full backend pipeline.

---

## 1. Overall System Architecture

```mermaid
graph TB
  subgraph CLIENT["Client Layer"]
    Browser["React 19 SPA<br/>TanStack Query · Radix UI · Framer Motion"]
  end

  subgraph GATEWAY["Express Gateway"]
    Helmet["Helmet (security headers)"]
    Compress["compression (gzip/brotli)"]
    RateLimit["rate-limit: 300 req / 15 min per IP"]
    BodyParser["express.json  50 MB limit"]
    TraceMiddleware["requestTraceMiddleware (AsyncLocalStorage trace ID)"]
  end

  subgraph ROUTES["Route Layer"]
    tRPC["/trpc/*  (tRPC 11)"]
    UploadRoute["/api/upload"]
    SSERoute["/api/sse"]
    OAuthRoute["/auth/google"]
    FalWebhook["/api/webhook/fal"]
    StripeWebhook["/api/webhook/stripe"]
    MediaDownload["/api/media/download"]
    AIProxy["/api/ai-proxy"]
    LangsmithProxy["/api/langsmith"]
  end

  subgraph TRPC_ROUTERS["tRPC App Router  (server/routers.ts)"]
    direction LR
    system["system"]
    auth["auth"]
    credits["credits"]
    generate["generate"]
    director["director"]
    orb["orb"]
    news["news"]
    proStudio["proStudio"]
    imageStudio["imageStudio"]
    videoStudio["videoStudio"]
    learnHub["learnHub"]
    loraTrainer["loraTrainer"]
    promptLibrary["promptLibrary"]
    externalServices["externalServices"]
    apiUsage["apiUsage"]
  end

  subgraph MIDDLEWARE["Context & Middleware"]
    authCtx["createContext (JWT / Cookie auth)"]
    brainCtx["brainContext (AI config + health ping)"]
    procTypes["publicProcedure · protectedProcedure · adminProcedure · brainProcedure"]
  end

  subgraph SERVICES["Service Layer"]
    falDispatcher["falDispatcher  (Fal.ai routing)"]
    modelClients["modelClients  (SDK orchestrator)"]
    providerRouter["providerRouter  (health-aware selection)"]
    voiceCompiler["voiceCompiler  (ElevenLabs TTS)"]
    audioCompiler["audioCompiler  (Suno music)"]
    geminiMedia["geminiMedia  (Gemini / Vertex AI)"]
    orbOrchestrator["orbTaskOrchestrator  (multi-step agent)"]
    ragMemory["ragMemory  (Pinecone vector DB)"]
    internalMedia["internalMedia  (URL localisation)"]
    authFacade["AuthFacade  (scrypt / bcrypt / argon2)"]
  end

  subgraph AI_PROVIDERS["External AI Providers"]
    Gemini["Google Gemini / Vertex AI"]
    FalAI["Fal.ai  (image · video · audio)"]
    ElevenLabs["ElevenLabs  (TTS / voice clone)"]
    Suno["Suno  (music generation)"]
    Replicate["Replicate  (LoRA fine-tuning)"]
    BraveSearch["Brave Search API"]
    NewsAPI["NewsAPI / NewsData.io"]
  end

  subgraph STORAGE["Storage Layer"]
    R2["Cloudflare R2 / AWS S3  (primary)"]
    GCS["Google Cloud Storage  (secondary)"]
    ManusForge["Manus Forge API  (fallback)"]
  end

  subgraph DB["Database Layer"]
    MySQL["MySQL  via Drizzle ORM"]
    Pinecone["Pinecone  (vector search)"]
  end

  subgraph JOBS["Background Jobs  (node-cron)"]
    newsFetcher["newsFetcher  every 6 h"]
    modelTraining["modelTrainingWorker  every 5 min"]
    learnDocSyncer["learnDocSyncer  hourly"]
    healthMonitor["apiHealthMonitor  every 10 min"]
    braveLearn["braveLearnFetcher  every 4 h"]
    r2Snapshot["r2SnapshotJob  daily"]
    providerSnapshot["providerSnapshotJob  daily"]
    usageAlert["apiUsageAlertJob  hourly"]
    autoCredit["userAutoCreditJob  every 24 h"]
  end

  subgraph OBS["Observability"]
    LangSmith["LangSmith  (LLM tracing & cost)"]
    Logger["Structured Logger  (JSON + trace IDs)"]
    PostHog["PostHog  (frontend analytics)"]
  end

  Browser -->|HTTPS| GATEWAY
  GATEWAY --> ROUTES
  ROUTES --> tRPC
  tRPC --> MIDDLEWARE
  MIDDLEWARE --> TRPC_ROUTERS
  TRPC_ROUTERS --> SERVICES
  SERVICES --> AI_PROVIDERS
  SERVICES --> STORAGE
  SERVICES --> DB
  SERVICES --> OBS
  JOBS --> AI_PROVIDERS
  JOBS --> DB
  FalWebhook -->|HMAC-SHA256 verified| SERVICES
  StripeWebhook --> SERVICES
  UploadRoute --> STORAGE
  SSERoute -->|server-push events| Browser
```

---

## 2. Request Lifecycle

```mermaid
sequenceDiagram
  participant C  as Client (React)
  participant GW as Express Gateway
  participant CTX  as createContext
  participant BRAIN as brainContext
  participant PROC  as tRPC Procedure
  participant SVC  as Service Layer
  participant DB   as MySQL
  participant EXT  as External Provider

  C->>GW: HTTP POST /trpc/[router].[procedure]
  GW->>GW: requestTraceMiddleware — assign traceId
  GW->>GW: helmet() + rateLimit() + compression()
  GW->>CTX: parse cookies / Authorization header
  CTX->>DB: SELECT user WHERE jwt.sub = userId
  CTX-->>GW: ctx = { req, res, user | null }
  GW->>BRAIN: brainContext.inject(ctx)
  BRAIN->>DB: SELECT user_ai_brain WHERE userId
  BRAIN->>BRAIN: health-ping AI engines (cached 5 min)
  BRAIN-->>GW: ctx.brain = BrainContext
  GW->>PROC: route to procedure (public / protected / admin)
  PROC->>PROC: Zod input validation
  PROC->>SVC: call service function
  SVC->>DB: read / write data
  SVC->>EXT: call AI provider (async)
  EXT-->>SVC: result or jobId
  SVC-->>PROC: typed response
  PROC-->>C: JSON via tRPC
```

---

## 3. AI Generation Pipeline

```mermaid
flowchart TD
  A([Client requests generation]) --> B["generate.prepareJob"]
  B --> B1{Enough credits?}
  B1 -->|No| ERR1([Error: insufficient credits])
  B1 -->|Yes| B2["Estimate points via modelPricing\n(100 pts ≈ $1 USD)"]
  B2 --> B3["Deduct remainingGenerations"]
  B3 --> B4["INSERT backgroundJob\nstatus = PENDING"]
  B4 --> C([Return jobId to client])

  C --> D["generate.executeJob(jobId)"]
  D --> D1["Load user brain config from brainContext"]
  D1 --> D2["providerRouter: select best engine\nbased on health + user preference"]
  D2 --> D3{Engine type?}

  D3 -->|image|      E1["falDispatcher → Fal.ai\nFlux Pro / Schnell"]
  D3 -->|video|      E2["falDispatcher → Fal.ai\nVideo models"]
  D3 -->|audio|      E3["audioCompiler → Suno"]
  D3 -->|voice/TTS|  E4["voiceCompiler → ElevenLabs"]
  D3 -->|multimodal| E5["geminiMedia → Gemini / Vertex AI"]
  D3 -->|LoRA train| E6["Replicate API — queue job"]

  E1 & E2 & E3 & E4 & E5 & E6 --> F["UPDATE backgroundJob\nstatus = IN_QUEUE / IN_PROGRESS"]

  F --> G([Client polls generate.getJobStatus])
  G --> G1{Status?}
  G1 -->|IN_PROGRESS| G
  G1 -->|FAILED|      ERR2([Return error · refund credits])
  G1 -->|COMPLETED|   H["generate.getJobResult"]

  subgraph WEBHOOK["Async Webhook — Fal.ai only"]
    W1["POST /api/webhook/fal"]
    W2["HMAC-SHA256 verify signature"]
    W3["internalMedia.localize\nCDN URLs → S3 / GCS"]
    W4["UPDATE backgroundJob COMPLETED\nPersist asset URLs"]
    W1 --> W2 --> W3 --> W4
  end

  E1 & E2 -->|webhook callback| WEBHOOK

  H --> H1["Return localised asset URLs"]
  H1 --> H2["INSERT digital_asset_library"]
  H2 --> I([Asset displayed in client])
```

---

## 4. Orb Agent System — State Machine

```mermaid
stateDiagram-v2
  [*] --> PENDING : orb.startTask\n(user submits goal)
  PENDING --> PLANNING : agentPlanner builds step plan
  PLANNING --> AWAITING_APPROVAL : plan ready — user gate
  AWAITING_APPROVAL --> EXECUTING : orb.approveTask
  AWAITING_APPROVAL --> CANCELLED : orb.cancelTask
  EXECUTING --> EXECUTING : execute step N via agentToolExecutor\n(loop until all steps done)
  EXECUTING --> AWAITING_APPROVAL : high-risk step detected\n(orbCostGuard / risk = high)
  EXECUTING --> COMPLETED : all steps done
  EXECUTING --> FAILED : unrecoverable step error
  COMPLETED --> [*]
  FAILED --> [*]
  CANCELLED --> [*]

  note right of EXECUTING
    Per step:
    orbTaskMemory  — track context
    orbReplyParser — LLM text → action
    orbAttachmentGuard — validate files
    orbIdempotency — prevent duplicates
    LangSmith — trace every LLM call
  end note
```

---

## 5. Background Jobs — Cron Schedule

```mermaid
gantt
  title Background Jobs (24-hour window)
  dateFormat HH:mm
  axisFormat %H:%M

  section Every 5 min
  modelTrainingWorker    :active, t1, 00:00, 5m

  section Every 10 min
  apiHealthMonitor       :active, t2, 00:00, 10m

  section Hourly
  learnDocSyncer         :t3, 00:00, 60m
  apiUsageAlertJob       :t4, 00:30, 60m

  section Every 4 h
  braveLearnFetcher      :t5, 00:00, 240m

  section Every 6 h
  newsFetcher            :t6, 00:00, 360m

  section Daily
  userAutoCreditJob      :t7, 00:00, 24h
  r2SnapshotJob          :t8, 02:00, 24h
  providerSnapshotJob    :t9, 02:30, 24h
```

> All jobs use an `isRunning` guard flag to prevent overlapping executions.

---

## 6. Database Schema — Core Tables (ERD)

```mermaid
erDiagram
  users {
    int      id                   PK
    string   email                UK
    string   role                 "user | admin"
    int      remainingGenerations
    boolean  autoCreditEnabled
    datetime createdAt
  }

  user_ai_brain {
    int      id            PK
    int      userId        FK
    string   imageEngine
    string   videoEngine
    string   voiceEngine
    string   audioEngine
    string   directorBrain
    string   analystBrain
    datetime updatedAt
  }

  background_jobs {
    string   id            PK
    int      userId        FK
    string   status        "PENDING|IN_QUEUE|IN_PROGRESS|COMPLETED|FAILED|CANCELLED"
    string   jobType       "image|video|audio|voice|multimodal|model_training"
    json     inputPayload
    json     outputPayload
    int      pointsCharged
    datetime createdAt
    datetime completedAt
  }

  digital_asset_library {
    int      id        PK
    int      userId    FK
    string   assetType "image|video|audio|voice|script"
    string   url
    string   localUrl
    json     metadata
    datetime createdAt
  }

  fine_tuned_models {
    int      id               PK
    int      userId           FK
    string   modelType        "image_subject|voice_clone|style_lora"
    string   replicateModelId
    string   status
    datetime trainedAt
  }

  api_usage_logs {
    int      id        PK
    int      userId    FK
    string   provider
    string   model
    int      tokensIn
    int      tokensOut
    decimal  costUsd
    datetime loggedAt
  }

  subscription_plans {
    int     id                 PK
    string  name
    int     monthlyGenerations
    decimal priceUsd
  }

  user_subscriptions {
    int      id        PK
    int      userId    FK
    int      planId    FK
    string   status    "active|past_due|cancelled"
    datetime expiresAt
  }

  orb_feedback_events {
    int      id        PK
    int      userId    FK
    string   taskId
    string   feedback
    datetime createdAt
  }

  users              ||--o{ user_ai_brain          : "has brain config"
  users              ||--o{ background_jobs         : "creates jobs"
  users              ||--o{ digital_asset_library   : "owns assets"
  users              ||--o{ fine_tuned_models        : "trains models"
  users              ||--o{ api_usage_logs           : "generates logs"
  users              ||--o| user_subscriptions       : "subscribes"
  user_subscriptions }o--|| subscription_plans       : "uses plan"
  background_jobs    ||--o{ digital_asset_library   : "produces assets"
```

---

## 7. Storage Layer — Backend Selection

```mermaid
flowchart TD
  A([storagePut / storageGet called]) --> B{Which env vars are set?}

  B -->|R2_ACCOUNT_ID or AWS_* vars|            C["Cloudflare R2 / AWS S3\nAWS Signature v4 (manual, zero deps)"]
  B -->|GOOGLE_APPLICATION_CREDENTIALS_JSON|    D["Google Cloud Storage\nService Account auth"]
  B -->|MANUS_FORGE_URL|                         E["Manus Forge API\nlegacy HTTP upload"]

  C --> F["Presigned URL — PUT"]
  C --> G["Presigned URL — GET"]
  C --> H["Multipart upload  > 5 MB"]

  D --> I["GCS streaming upload"]
  D --> J["GCS signed URL"]

  E --> K["HTTP multipart POST"]

  F & G & H & I & J & K --> L(["Return { key, url }"])

  L --> M["internalMedia.localize\nstore local URL in DB\nproxy CDN → local storage"]
```

---

## 8. Authentication Flow

```mermaid
sequenceDiagram
  participant C    as Client
  participant GW   as Express
  participant OA   as Google OAuth 2.0
  participant AUTH as AuthFacade
  participant DB   as MySQL
  participant JWT  as JWT Service

  Note over C,JWT: Google OAuth login
  C->>GW: GET /auth/google
  GW->>OA: redirect to Google consent screen
  OA-->>GW: GET /auth/google/callback?code=…
  GW->>OA: exchange code for tokens
  OA-->>GW: { access_token, id_token }
  GW->>AUTH: upsertGoogleUser(profile)
  AUTH->>DB: SELECT / INSERT users WHERE googleId
  DB-->>AUTH: user record
  AUTH->>JWT: sign({ sub: userId }, JWT_SECRET, 365 d)
  JWT-->>GW: token string
  GW-->>C: Set-Cookie: token=…; HttpOnly; Secure

  Note over C,JWT: Subsequent authenticated request
  C->>GW: POST /trpc/…  Cookie: token=…
  GW->>JWT: verify(token, JWT_SECRET)
  JWT-->>GW: { sub: userId }
  GW->>DB: SELECT user WHERE id = userId
  DB-->>GW: user record (role, credits, …)
  GW->>GW: ctx.user = user
  GW->>GW: protectedProcedure asserts ctx.user !== null
```

---

## Critical File Reference

| File | Role |
|------|------|
| `server/_core/index.ts` | Server bootstrap, route registration, cron init |
| `server/routers.ts` | tRPC app router — all API endpoints (6 000+ lines) |
| `server/_core/context.ts` | JWT / OAuth auth, `createContext` |
| `server/middleware/brainContext.ts` | AI brain config injection + health checks |
| `server/db.ts` | MySQL pool init (Drizzle ORM) |
| `server/storage.ts` | Multi-backend storage abstraction |
| `server/services/falDispatcher.ts` | Fal.ai model dispatch + fallback |
| `server/services/modelClients.ts` | SDK orchestrator (`SafeApiCaller` + all providers) |
| `server/services/providerRouter.ts` | Health-aware provider selection |
| `server/services/orbTaskOrchestrator.ts` | Orb multi-step agent coordinator |
| `server/routes/webhookFal.ts` | Async Fal.ai result ingestion |
| `drizzle/schema.ts` | Full database schema |
| `server/jobs/*.ts` | All background cron jobs |
