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

---

## 9. LLM Engine Routing & Circuit Breaker

```mermaid
flowchart TD
  A([invokeLLM called]) --> B[Inject system prompt from ctx.brain]
  B --> C{engine param set?}

  C -->|explicit engine| D[Use that engine only\nNo fallback]
  C -->|preferEngine set| E[Try preferEngine first\nauto-downgrade on failure]
  C -->|auto| F[resolveEngineConfig\nhealth-aware selection]

  F --> F1{Which env vars set?}
  F1 -->|GEMINI_API_KEY| G1["gemini  priority 10"]
  F1 -->|NVIDIA_API| G2["nvidia  priority 30"]
  F1 -->|GOOGLE_APPLICATION_CREDENTIALS_JSON| G3["vertex  priority 40"]
  F1 -->|BUILT_IN_FORGE_API_KEY| G4["forge  priority 50"]

  G1 & G2 & G3 & G4 --> H[Filter by circuit breaker state\nCLOSED or HALF_OPEN only]
  H --> I[Pick highest priority available engine]

  D & E & I --> J[invokeSingleEngine]

  J --> J1[normalizeModelForEngine\ngpt-4o → gemini-2.5-pro etc.]
  J1 --> J2[Build payload\ntemperature · topP · tools · response_format]
  J2 --> J3[Retry loop  max 3 attempts\nbackoff: 1s → 2s → 4s  cap 8s\ntimeout: 60s per attempt]
  J3 --> J4{HTTP response}

  J4 -->|2xx| J5[recordEngineSuccess\nreset failure counter]
  J5 --> J6[Track in LangSmith\ntokens · cost · finish_reason]
  J6 --> OK([Return LLMResponse])

  J4 -->|5xx / 429 / network| J7[recordEngineFailure\nincrement counter]
  J7 --> J8{failures >= 3\nor HALF_OPEN probe?}
  J8 -->|Yes| OPEN["Circuit → OPEN\ncooldown 60 s"]
  J8 -->|No| J3
  OPEN --> J9{More engines\nin fallback chain?}
  J9 -->|Yes| J
  J9 -->|No| ERR([Throw: all engines failed])

  subgraph CB["Circuit Breaker States"]
    CLOSED["CLOSED  healthy\nrequests pass through"]
    OPEN2["OPEN  failed\nrequests blocked for 60 s"]
    HALF["HALF_OPEN  probing\none request allowed through"]
    CLOSED -->|3 consecutive failures| OPEN2
    OPEN2 -->|60 s elapsed| HALF
    HALF -->|success| CLOSED
    HALF -->|failure| OPEN2
  end
```

---

## 10. Brain Context Middleware — Detailed Flow

```mermaid
flowchart TD
  A([brainProcedure called]) --> B[buildBrainContext userId]

  B --> C{DB available?}
  C -->|Yes| D[SELECT user_ai_brain WHERE userId]
  C -->|No| E[Use hardcoded defaults\nlog DB fallback warning]

  D --> F{Row exists?}
  F -->|No| E
  F -->|Yes| G[Parse model / engine per slot]

  G & E --> H[For each of 9 slots\n5 reasoning + 4 generation]

  H --> I[getHealthStatus model\ncached 60 s]
  I --> I2{Cache hit?}
  I2 -->|Yes| I3[Return cached healthy/degraded]
  I2 -->|No| I4[scheduleHealthCheck async\nsetImmediate non-blocking\nReturn optimistic true]

  I3 & I4 --> J{healthy?}
  J -->|Yes| K[Use configured model/engine]
  J -->|No| L[findFallback slot ENGINE_FALLBACK_CHAIN]

  L --> L2{Fallback candidate healthy?}
  L2 -->|Yes| L3[Use fallback\nlog DegradationEvent]
  L2 -->|No| L4[Try next candidate]
  L4 --> L2
  L4 -->|All exhausted| L5[Use hardcoded default]

  K & L3 & L5 --> M[Build ReasoningBrainConfig\nor GenerationEngineConfig]

  M --> N[Assemble BrainContext\nreasoning map + generation map\n+ degradationSummary]
  N --> O[Inject into ctx.brain]
  O --> P([Procedure executes with\nctx.brain.getBrain director\nctx.brain.getEngine imageEngine etc.])

  subgraph DEFAULTS["Default Models"]
    D1["director → gemini-2.5-pro  temp 0.4"]
    D2["analyst → gemini-2.5-flash  temp 0.3"]
    D3["storyteller → gemini-2.5-pro  temp 0.9"]
    D4["technician → gemini-2.5-flash  temp 0.2"]
    D5["curator → gemini-2.5-flash  temp 0.8"]
    D6["imageEngine → fal-ai/flux-pro/v1.1"]
    D7["videoEngine → fal-ai/kling-video/v2.1/standard/text-to-video"]
    D8["audioEngine → fal-ai/ace-step"]
    D9["voiceEngine → fal-ai/elevenlabs/tts/turbo-v2.5"]
  end
```

---

## 11. Complete tRPC Router Map

```mermaid
mindmap
  root((appRouter))
    system
      healthCheck
      version
    auth
      me
      logout
    credits
      pricingCatalog
      myBalance
    profile
      get
      update
      changePassword
    settings
      get
      update
    dashboard
      stats
    generate
      prepareJob
      estimateCost
      multimodal
    director
      directorPreferences.get
      directorPreferences.update
    notes
      list
      create
      update
      delete
    vault
      list
      create
      update
      delete
    assets
      list
      getById
      create
      delete
      favourite
    history
      list
      getDetail
      delete
    feedback
      create
      list
      aggregate
    plans
      list
      subscribe
    customBlocks
      list
      upsert
    blockCombos
      list
      upsert
    brain
      catalog
      get
      upsert
      switchModel
      pricingSummary
      healthStatus
      orbVoicePreview
      pingProviders
      monitorSummary
      autoRepairConfig
      toggleAutoRepair
      alerts
      errorTraces
      reportError
      resolveError
      diagnoseError
      proposals
      createProposal
      approveProposal
      webSearch
      accuracyTests
      runAccuracyTest
    news
      list
      getById
    showcase
      list
    sense
      analyze
    proStudio
      textToMusic
      soundEffects
      elevenLabsTTS
      qwenTTS
      qwenCloneVoice
      qwenCloneAndSpeak
      diaTTSVoiceClone
      demucs
      audioIsolation
      mergeAudios
      voiceChanger
      speechToText
      speechToVideo
      echoMimic
      stableAvatar
      dubbing
      longcatAvatar
      ltxAudioToVideo
      jobStatus
      jobResult
      checkAudioStatus
      compiledTextToMusic
    imageStudio
      nanoBanana2
      nanoBananaPro
      seedreamV4
      imagen4
      nanoBananaProEdit
      stableDiffusion35
      fastSdxl
      sdLora
      fluxKontext
      seedVRUpscale
      dwPose
      trellis2
      sam3dObjects
      hunyuan3d
      rodin3d
      checkImageStatus
    videoStudio
      textToVideo
      imageToVideo
      videoToVideo
      klingVideo
      wanVideo
      ltxVideo
      veo3Flash
      runwayGen4
      checkVideoStatus
    learnHub
      list
      search
      featured
      byTag
      get
      create
      update
      delete
    loraTrainer
      stats
      replicateStatus
      trainingHistory
      modelDetail
      trainingLogs
    promptLibrary
      list
      getById
      create
      update
      delete
      toggleFavorite
      incrementUseCount
      listPublic
    externalServices
      list
      upsert
      delete
      summary
      updateApiKeyStatus
    apiUsage
      overview
      usageByProvider
      usageEvents
      snapshots
      billing
      rateLimit.list
      rateLimit.upsert
      rateLimit.delete
      alerts.list
      alerts.upsert
    langsmith
      runs
      runDetail
      feedback
      datasets
      createExample
      compareModels
      productionMetrics
      exportData
    ai
      orbTask.startTask
      orbTask.task
      orbTask.taskTimeline
      orbTask.toolCallLogs
      orbTask.approveTask
      orbTask.approveTaskStep
      orbTask.reportTaskStep
      orbTask.tools
      orbTask.chat
      orbMemory.recent
      orbMemory.search
      orbMemory.clearForUser
      orbMemory.deleteOne
      orbMemory.plannerSummary
      codeTask.list
      codeTask.create
      codeTask.get
      codeTask.approve
      codeTask.cancel
      codeTask.retry
      codeTask.events
    admin
      userList
      updateUser
      systemStats
```

---

## 12. Model Pricing & Points Estimation

```mermaid
flowchart TD
  A([estimatePoints modelId, durationSec, charCount, imageCount, trainingSteps]) --> B[getModelPricing modelId]

  B --> C{Found in 200+ model catalog?}
  C -->|No| ERR([Return null])
  C -->|Yes| D[total = basePoints]

  D --> E{durationSec > 0\nAND pointsPerSecond set?}
  E -->|Yes| E1["extra = round(durationSec × pointsPerSecond)\ntotal += extra"]
  E -->|No| F

  E1 --> F{charCount > 0\nAND pointsPer1kChars set?}
  F -->|Yes| F1["charPts = ceil(charCount ÷ 1000 × pointsPer1kChars)\ntotal += charPts"]
  F -->|No| G

  F1 --> G{imageCount > 1\nAND pointsPerImage set?}
  G -->|Yes| G1["imgExtra = pointsPerImage × (imageCount − 1)\ntotal += imgExtra"]
  G -->|No| H

  G1 --> H{trainingSteps > 0\nAND pointsPerStep set?}
  H -->|Yes| H1["stepPts = round(trainingSteps × pointsPerStep)\ntotal += stepPts"]
  H -->|No| I

  H1 --> I["Clamp: max(minPoints, min(maxPoints, total))"]
  I --> J([Return PointsEstimate\ntotal · breakdown · usdEquivalent])

  subgraph SAMPLE_PRICES["Sample Model Pricing  100 pts ≈ $1 USD"]
    P1["Flux Pro 1.1  →  4 pts/image  premium"]
    P2["Flux Schnell  →  1 pt/image  economy"]
    P3["Kling V2.1 Pro  →  49 pts base + 9.8 pts/sec  ultra"]
    P4["ElevenLabs V3  →  4 pts base + 4 pts/1k chars  premium"]
    P5["Gemini 2.5 Pro  →  3 pts base + 3 pts/1k chars  premium"]
    P6["Flux LoRA Training  →  200 pts base + 0.1 pts/step  ultra"]
    P7["Gemini 2.5 Flash  →  1 pt  free tier"]
  end
```

---

## 13. Provider Selection Algorithm (Intent-Based)

```mermaid
flowchart TD
  A([selectProvider intent, preferredProviderId?]) --> B[getProviderCatalog\nbuild map of all providers]

  B --> C[desiredProviderIds intent\nreturn ordered candidate list]

  C --> C1{Intent type?}
  C1 -->|planner_text| R1["gemini → default_llm"]
  C1 -->|planner_multimodal| R2["gemini → default_llm\nforce multimodal flag"]
  C1 -->|planner_pdf| R3["gemini → default_llm"]
  C1 -->|code_task| R4["claudeCode → codex"]
  C1 -->|generate_image| R5["fal"]
  C1 -->|generate_video| R6["fal"]
  C1 -->|generate_audio| R7["suno → fal"]
  C1 -->|voice_tts| R8["elevenlabs → fal"]
  C1 -->|music| R9["suno"]
  C1 -->|default| R10["gemini → default_llm"]

  R1 & R2 & R3 & R4 & R5 & R6 & R7 & R8 & R9 & R10 --> D[Override with preferredProviderId\nif provided and supports intent]

  D --> E["Pass 1: Find first HEALTHY primary candidate\ngetProviderHealth status === healthy"]

  E --> F{Healthy primary found?}
  F -->|Yes| G([Return provider + fallbackChain])

  F -->|No| H["Pass 2: For each candidate\ncheck their fallback providers"]
  H --> I{Any healthy fallback?}
  I -->|Yes| G
  I -->|No| J([Return degraded provider\n+ reason: all_providers_unhealthy])

  subgraph CATALOG["Provider Catalog (env-gated)"]
    PC1["gemini  priority 10  multimodal  40MB  20s  GEMINI_API_KEY"]
    PC2["nvidia  priority 30  text  8MB  18s  NVIDIA_API"]
    PC3["default_llm  priority 50  text  6MB  18s  no key"]
    PC4["fal  priority 10  image+video  25MB  45s  FAL_KEY"]
    PC5["elevenlabs  priority 10  voice  12MB  30s  ELEVENLABS_API_KEY"]
    PC6["suno  priority 10  audio  10MB  40s  0 retries  SUNO_API_KEY"]
    PC7["claudeCode  priority 10  code  2MB  30s  ENABLE_CLAUDE_CODE_TASKS"]
  end
```

---

## 14. Orb Task Orchestrator — Dual State Sync

```mermaid
sequenceDiagram
  participant UI   as Client / UI
  participant TRPC as tRPC orb router
  participant ORCH as orbTaskOrchestrator
  participant STORE as OrbTaskStore (DB)
  participant FSM  as OrbAgentTask FSM (memory)
  participant EXEC as agentToolExecutor
  participant MEM  as orbMemory (long-term)

  UI->>TRPC: ai.orbTask.startTask goal
  TRPC->>ORCH: runSchemaFirstAgentPlanner messages
  ORCH->>FSM: createOrbAgentTaskFromPlanner plan
  FSM-->>ORCH: OrbAgentTask status=awaiting_approval
  ORCH->>STORE: create OrbTask status=planned
  STORE-->>TRPC: taskId
  TRPC-->>UI: { taskId }

  UI->>TRPC: ai.orbTask.approveTask taskId
  TRPC->>STORE: approve → status=running
  STORE->>FSM: approveOrbAgentTask
  FSM-->>STORE: status=executing step[0]=running

  loop Each step N
    TRPC->>ORCH: runOrbTaskToCompletion taskId
    ORCH->>STORE: fetch current OrbTask
    ORCH->>FSM: check step N approval

    alt Step needs human approval
      ORCH-->>TRPC: blockedByApproval=true
      TRPC-->>UI: outcome=awaiting_approval
      UI->>TRPC: ai.orbTask.approveTaskStep stepId token
      TRPC->>STORE: approveStep token+expiry
    end

    ORCH->>EXEC: executeOrbToolCalls step.toolCalls
    EXEC-->>ORCH: toolResults ok/fail

    alt Tool success
      ORCH->>STORE: reportStep ok=true
      ORCH->>FSM: completeOrbAgentStep
      FSM->>MEM: recordOrbTaskMemory short-term
    else Tool failure
      ORCH->>STORE: reportStep ok=false errorCode
      ORCH->>FSM: failOrbAgentStep
      FSM->>MEM: record failure+recovery suggestions
      ORCH-->>TRPC: outcome=failed
    end
  end

  FSM->>MEM: recordOrbMemory type=successful_workflow
  ORCH-->>TRPC: outcome=completed stepsRun=N
  TRPC-->>UI: task completed
```

---

## 15. Authentication & Session — Complete Detail

```mermaid
flowchart TD
  subgraph GOOGLE_OAUTH["Google OAuth 2.0 Flow"]
    A1[GET /auth/google] --> A2[buildGoogleAuthUrl redirectAfter]
    A2 --> A3["Redirect → accounts.google.com\nscope: openid email profile\naccess_type: offline\nprompt: select_account"]
    A3 --> A4["GET /auth/google/callback?code=…&state=…"]
    A4 --> A5[exchangeCodeForTokens code]
    A5 --> A6["Google: { access_token, id_token }"]
    A6 --> A7[getGoogleUserInfo access_token]
    A7 --> A8["{ sub, name, email, picture }"]
    A8 --> A9[upsertGoogleUser profile\nSELECT or INSERT users]
    A9 --> A10["createSessionToken sub, name, email\nHS256 + JWT_SECRET + 365 days"]
    A10 --> A11["Set-Cookie: app_session_id=token\nHttpOnly · Secure · SameSite=none on HTTPS"]
  end

  subgraph REQUEST_AUTH["Per-Request Authentication"]
    B1[HTTP request arrives] --> B2[requestTraceMiddleware\nassign / read x-trace-id]
    B2 --> B3[createContext tRPC]
    B3 --> B4[authenticateRequest req]
    B4 --> B5{Cookie app_session_id\nor Authorization Bearer?}
    B5 -->|Missing| B6[ctx.user = null]
    B5 -->|Present| B7[verifySessionToken jose jwtVerify]
    B7 --> B8{Valid?}
    B8 -->|No| B6
    B8 -->|Yes| B9["{ sub, name, email }"]
    B9 --> B10[SELECT user WHERE id = sub\nvia getUserByOpenId]
    B10 --> B11[ctx.user = user record\nid · role · remainingGenerations]
  end

  subgraph PROCEDURE_GUARDS["Procedure Auth Guards  server/_core/trpc.ts"]
    G1["publicProcedure\nNo check"]
    G2["protectedProcedure\nctx.user !== null\nor UNAUTHORIZED"]
    G3["adminProcedure\nctx.user.role === admin\nor FORBIDDEN"]
    G4["brainProcedure\nprotected + buildBrainContext\ninjected into ctx.brain"]
  end

  subgraph DEMO_MODE["Demo Mode  no DATABASE_URL"]
    DM1[Token matches demo-user-001] --> DM2[Return hardcoded DEMO_USER\nid=1 · role=user · 100 image quota]
  end

  B11 --> PROCEDURE_GUARDS
  B6 --> G1
```

---

## 16. Feature Flags Reference

```mermaid
mindmap
  root((Feature Flags\nenv vars))
    Orb Agent
      ENABLE_SCHEMA_FIRST_PLANNER
      ENABLE_ORB_TASK_STATE_MACHINE
      ENABLE_ORB_TASK_MEMORY
      ENABLE_ORB_TASK_RECOVERY
      ENABLE_ORB_TASK_EXECUTOR
      ENABLE_ORB_LONG_TERM_MEMORY
      ENABLE_ORB_COST_GUARD
      ENABLE_ORB_QUOTA_GUARD
      ENABLE_ORB_IDEMPOTENCY_GUARD
      ENABLE_ORB_CODE_COLLABORATION
      ENABLE_ORB_PROVIDER_ROUTER
    Code Execution
      ENABLE_CLAUDE_CODE_TASKS
      ENABLE_CODEX_TASKS
    Agent UI
      VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS
      VITE_ENABLE_GLOBAL_AGENT_TELEMETRY
      ENABLE_GLOBAL_AGENT_CAPABILITY_REGISTRY
      ENABLE_GLOBAL_AGENT_TOOL_REGISTRY
    LLM Engine
      LLM_ENGINE auto/gemini/vertex/forge/nvidia
    Observability
      LANGCHAIN_TRACING_V2
      POSTHOG_API_KEY
```

---

## 17. SSE Event Bus — Generation Real-Time Stream

```mermaid
sequenceDiagram
  participant C  as Client (React)
  participant GW as Express GET /api/generation-events/:jobId
  participant BUS as GenerationEventBus (EventEmitter)
  participant SVC as Service / Procedure

  C->>GW: GET /api/generation-events/42
  GW->>GW: Validate jobId (integer) → 400 if NaN
  GW->>C: Headers: Content-Type=text/event-stream\nCache-Control=no-cache\nX-Accel-Buffering=no
  GW->>C: data: {"type":"connected","jobId":42}

  GW->>BUS: subscribe("job:42", callback)
  Note over GW: Heartbeat every 15 s → ": heartbeat"
  Note over GW: Auto-close after 5 min (SSE_MAX_LIFETIME_MS)

  SVC->>BUS: emit(42, {type:"thought-update", node:{...}})
  BUS->>GW: callback fires
  GW->>C: data: {"type":"thought-update","node":{...}}

  SVC->>BUS: emit(42, {type:"progress", pct:60, message:"..."})
  BUS->>GW: callback fires
  GW->>C: data: {"type":"progress","pct":60}

  SVC->>BUS: emit(42, {type:"complete", chain:[...]})
  BUS->>GW: callback fires
  GW->>C: data: {"type":"complete","chain":[...]}
  Note over GW: 500 ms delay then close connection

  C-->>GW: disconnect
  GW->>BUS: unsubscribe("job:42")
  BUS->>BUS: cleanup(42) — remove all listeners

  Note over BUS: Max 100 concurrent listeners per instance\nChannel key pattern: "job:{jobId}"

  subgraph EVENT_TYPES["4 Event Types  (generationEvents.ts)"]
    T1["thought-update — reasoning node progress"]
    T2["progress — numeric % + message"]
    T3["complete — final thought chain array"]
    T4["error — error message"]
  end
```

---

## 18. Upload Route — File Upload Pipeline

```mermaid
flowchart TD
  A([POST /api/upload]) --> B[authenticateRequest req\nJWT / Cookie]
  B --> B1{Authenticated?}
  B1 -->|No| ERR1([401 Unauthorized])
  B1 -->|Yes| C[Parse JSON body\nfileName · mimeType · data base64]

  C --> D{MIME type\nin whitelist?}
  D -->|No| ERR2([415 Unsupported Media Type])
  D -->|Yes| E[Classify kind\nimage · audio · video · pdf]

  E --> F{data size\nvs PER_KIND_MAX?}
  F -->|Exceeds| ERR3([413 Payload Too Large])
  F -->|OK| G{data size\nvs 40 MB absolute?}
  G -->|Exceeds| ERR3
  G -->|OK| H["Generate file key\nuploads/{userId}/{safeName}-{nanoid8}.{ext}"]

  H --> I[storagePut fileKey buffer mimeType\nS3 / R2 / GCS]
  I --> I1{Storage configured?}
  I1 -->|No| ERR4([503 Storage not configured])
  I1 -->|Yes| J[classifyInlineEligibility]

  J --> J1{kind = audio\nor video?}
  J1 -->|Yes| K1["inlineEligible: false\nrecommendation: use-storage-url-required"]
  J1 -->|No| J2{size > 1 MB?}
  J2 -->|Yes| K2["inlineEligible: false\nrecommendation: use-storage-url"]
  J2 -->|No| K3["inlineEligible: true\nrecommendation: inline-ok"]

  K1 & K2 & K3 --> L(["200 { url, fileKey, fileName,\nmimeType, fileSizeBytes,\ninlineEligible, inlineRecommendation }"])

  subgraph LIMITS["Size Limits (PER_KIND_MAX_BYTES)"]
    L1["image  10 MB"]
    L2["audio  20 MB"]
    L3["video  40 MB"]
    L4["pdf    12 MB"]
    L5["absolute ceiling  40 MB"]
    L6["inline threshold  1 MB"]
  end
```

---

## 19. AI Proxy Gateway — /api/ai/:provider/*

```mermaid
flowchart TD
  A([ANY /api/ai/:provider/path]) --> B[optionalVerifyToken\nhydrate user if token present]
  B --> C{provider in\nVALID_PROVIDERS?}
  C -->|No| ERR1([400 Invalid provider])
  C -->|Yes| D[Read API key from serverEnv\nfal_ai / gemini / elevenlabs / suno]

  D --> E{API key set?}
  E -->|No| ERR2([503 API key not configured])
  E -->|Yes| F[checkRateLimit providerKey userId\nper-user daily + global daily]

  F --> F1{Rate limit\nexceeded?}
  F1 -->|Yes| G[Log attempt to DB] --> ERR3([429 Rate Limited])
  F1 -->|No| H["Sanitize pathSuffix\nremove '..' strip unsafe chars"]

  H --> I[Reconstruct target URL\nbaseUrl + sanitizedPath + queryString]
  I --> J{Hostname matches\nexpected provider?}
  J -->|No| ERR4([400 SSRF blocked])
  J -->|Yes| K[Strip hop-by-hop headers\nInject API key header]

  K --> L[getAdapter provider .proxy request\n120 s timeout]
  L --> M{Response?}
  M -->|AbortError| ERR5([504 Gateway Timeout])
  M -->|Network error| ERR6([502 Bad Gateway])
  M -->|OK| N[Forward safe response headers\ncontent-type · x-request-id · x-ratelimit-remaining]

  N --> O([Return response body as Buffer])

  O --> P[setImmediate async logging]
  P --> P1[INSERT aiUsageEvents DB\nprovider · endpoint · userId · status · latencyMs · costUsd]
  P --> P2[PostHog event ai_api_call\nprovider · endpoint · userId · status · latencyMs]
  P --> P3[LangSmith traceToolRun\napi-proxy/provider · request bytes · response status]

  subgraph PROVIDERS["4 Supported Providers"]
    PR1["fal_ai  → fal.run\nAuthorization: Key {key}"]
    PR2["gemini  → generativelanguage.googleapis.com\nx-goog-api-key: {key}"]
    PR3["elevenlabs → api.elevenlabs.io\nxi-api-key: {key}"]
    PR4["suno → api.sunoapi.org\nAuthorization: Bearer {key}"]
  end
```

---

## 20. Media Download Proxy — SSRF Protection

```mermaid
flowchart TD
  A([GET /api/media/download?url=…&filename=…]) --> B[Decode URI component url]
  B --> C{Valid URL\nformat?}
  C -->|No| ERR1([400 Invalid URL])
  C -->|Yes| D[isAllowedOrigin url]

  D --> D1{Origin matches\nS3_PUBLIC_URL or\nS3_PUBLIC_DOMAIN or\nBUILT_IN_FORGE_API_URL?}
  D1 -->|No| ERR2([403 Disallowed origin — SSRF blocked])
  D1 -->|Yes| E[fetch url\n60 s AbortSignal timeout]

  E --> F{Response ok?}
  F -->|No| ERR3([502 Upstream error])
  F -->|Yes| G[Read Content-Type from upstream\nor inferExtension from URL path]

  G --> H[Set response headers\nContent-Type\nContent-Disposition: attachment filename\nContent-Length if present\nCache-Control: no-store]

  H --> I[Stream body chunks\nreader.read loop]
  I --> J{Reader available?}
  J -->|No| ERR4([502 Stream read failure])
  J -->|Yes| K([Chunked binary stream to client])
```

---

## 21. Orb Guard Chain — 4-Layer Safety Pipeline

```mermaid
flowchart TD
  A([User submits Orb task]) --> G1

  subgraph G1["Guard 1: orbIdempotency (orbIdempotency.ts)"]
    I1[buildOrbIdempotencyKey\nhash userId + text + attachmentUrls]
    I2{Duplicate found\nwithin 90 s?}
    I3[rememberTaskKey store hash → taskId]
    I1 --> I2
    I2 -->|Yes| IDUP([Return cached task — skip execution])
    I2 -->|No| I3
  end

  I3 --> G2

  subgraph G2["Guard 2: orbAttachmentGuard (orbAttachmentGuard.ts)"]
    A1[Scan message content parts\ntype=file_url or image_url]
    A2[inferKind mime\nimage · audio · video · pdf · unknown]
    A3{Kind = unknown?}
    A4{totalBytes > LIMITS kind?}
    A1 --> A2 --> A3
    A3 -->|Yes| AERR([Reject: unsupported format])
    A3 -->|No| A4
    A4 -->|Yes| AERR2([Reject: file too large\nimage 10MB audio 20MB video 40MB pdf 12MB])
    A4 -->|No| A5[Pass — totalBytes · kinds list]
  end

  A5 --> G3

  subgraph G3["Guard 3: orbCostGuard (orbCostGuard.ts)"]
    C1[Score intent:\noutput type · modality · duration\nassets · cross-page steps · provider · retries]
    C2{Cost tier?}
    C3["free / low → proceed silently"]
    C4["medium / high → requiresHuman = true"]
    C1 --> C2
    C2 --> C3
    C2 --> C4
    C4 --> CGATE{User confirmed?}
    CGATE -->|No| CERR([Block — show confirmation prompt in Chinese])
    CGATE -->|Yes| C5[Pass]
    C3 --> C5
  end

  C5 --> G4

  subgraph G4["Guard 4: orbQuota (orbQuota.ts)"]
    Q1{category?}
    Q1 -->|rapid_click| Q2["Sliding window 10 s\nmax 6 clicks per session"]
    Q1 -->|provider_rate| Q3["Sliding window 60 s\nmax 120 req/min per provider"]
    Q1 -->|planner| Q4[Daily counter max 200]
    Q1 -->|generation| Q5[Daily counter max 40]
    Q1 -->|multimodal_analysis| Q6[Daily counter max 30]
    Q1 -->|code_task| Q7[Daily counter max 12]
    Q1 -->|task_retry| Q8[Max 1 retry allowed]
    Q2 & Q3 & Q4 & Q5 & Q6 & Q7 & Q8 --> QR{Limit\nexceeded?}
    QR -->|Yes| QERR([429 Quota exceeded — reason message])
    QR -->|No| QPASS[Consume quota slot]
  end

  QPASS --> EXEC([Execute Orb task via orbTaskOrchestrator])
```

---

## 22. internalMedia — URL Localization Tree Walk

```mermaid
flowchart TD
  A([localizeResultUrls value prefix]) --> B{typeof value?}

  B -->|string| C{isInternalUrl?}
  C -->|Yes| SKIP([Return as-is — already local])
  C -->|No| D[persistExternalMediaUrl url]

  D --> D1[fetch url\n90 s AbortSignal timeout]
  D1 --> D2{Response ok?}
  D2 -->|No| ERR([Throw 下載外部媒體失敗])
  D2 -->|Yes| D3[arrayBuffer → Buffer]

  D3 --> D4[inferExtension contentType url category]
  D4 --> D4A{MIME type?}
  D4A -->|image/*| EXT1[png / webp / jpg / gif]
  D4A -->|video/*| EXT2[mp4 / webm]
  D4A -->|audio/*| EXT3[mp3 / wav / ogg]
  D4A -->|includes pdf| EXT4[pdf]
  D4A -->|none| EXT5[URL path suffix → category default]

  EXT1 & EXT2 & EXT3 & EXT4 & EXT5 --> D5["Generate key\n{prefix}/{timestamp}-{random}.{ext}"]
  D5 --> D6[storagePut key buffer contentType\nS3 / GCS]
  D6 --> LOCAL([Return S3/GCS public URL])

  B -->|array| ARR["Promise.all elements\n→ walk each item"]
  B -->|object| OBJ["Promise.all entries\n→ walk each value\npreserve keys"]

  ARR & OBJ --> B

  subgraph CLASSIFY["classifyByKey — infer category from key path"]
    K1["key contains 'voice' → voice"]
    K2["key contains 'audio' → audio"]
    K3["key contains 'video' → video"]
    K4["key contains image/thumbnail/mask/texture/pose → image"]
    K5["default → binary"]
  end

  subgraph IS_INTERNAL["isInternalUrl — skip if already internal"]
    P1["relative URL → internal"]
    P2["starts with S3_PUBLIC_URL → internal"]
    P3["starts with S3_PUBLIC_DOMAIN → internal"]
    P4["starts with BUILT_IN_FORGE_API_URL → internal"]
  end
```

---

## 23. brainAutoRepair — 5-Subsystem Self-Healing Architecture

```mermaid
graph TB
  subgraph SUBSYS1["Subsystem 1: API Health Monitor + Auto-Repair"]
    S1A["runHealthPatrol (called by cron)"]
    S1B["pingProvider endpoint\n8 s timeout\nreturns ok · latencyMs · error"]
    S1C["attemptAutoRepair engine"]
    S1D{"Provider\nhealthy?"}
    S1E["reportEngineRecovery\ncreate info alert"]
    S1F["Iterate ENGINE_FALLBACK_CHAIN\n~50 chains · ping each fallback"]
    S1G{"Fallback\nhealthy?"}
    S1H["Use fallback\ncreate warning alert"]
    S1I["All failed\ncreate critical alert\nrecordErrorTrace"]
    S1A --> S1B --> S1D
    S1D -->|Yes| S1E
    S1D -->|No| S1C --> S1F --> S1G
    S1G -->|Yes| S1H
    S1G -->|No| S1I
  end

  subgraph SUBSYS2["Subsystem 2: Error Trace + Diagnosis"]
    S2A["recordErrorTrace modality engine prompt error"]
    S2B["classifyError message + code\n10 categories · regex patterns"]
    S2C["enrichTraceWithDiagnosis\nerrorCategory · rootCause · confidence=85"]
    S2D["autoSearchForFix async\nfire-and-forget web search"]
    S2E["diagnoseError traceId\nfind related traces\nboost confidence +3 per related · max 95"]
    S2A --> S2B --> S2C --> S2D
    S2E -.->|on demand| S2A
  end

  subgraph SUBSYS3["Subsystem 3: Self-Reflection Proposals"]
    S3A["createReflectionProposal\ncategory · title · currentValue · proposedValue · confidence"]
    S3B["Status: pending → approved / rejected"]
    S3C["Admin reviews via brain.approveProposal\nor brain.rejectProposal"]
    S3A --> S3B --> S3C
  end

  subgraph SUBSYS4["Subsystem 4: Web Research"]
    S4A["webSearch query maxResults"]
    S4B{"Brave Search\nAPI key set?"}
    S4C["GET api.search.brave.com\nX-Subscription-Token header\nrelevance=80"]
    S4D["GitHub API fallback\nsearch repositories by stars\nrelevance = min(90, 50+stars/100)"]
    S4E["addResearchToLearnHub\nconvert to LearnDoc\ntags: 爬網研究 + keywords"]
    S4A --> S4B
    S4B -->|Yes| S4C --> S4E
    S4B -->|No| S4D --> S4E
  end

  subgraph SUBSYS5["Subsystem 5: Accuracy Testing"]
    S5A["runAccuracyTest engine testType testPrompt expected"]
    S5B["POST Gemini API\ntemperature=0.1 maxTokens=256 15 s timeout"]
    S5C{"Score by type"}
    S5D["response_quality: len 10-500 → 90"]
    S5E["latency: <3s → 95  <5s → 70  else → 40"]
    S5F["consistency: valid JSON → 95  else → 30"]
    S5G["error_rate: no error → 90  else → 20"]
    S5H{"score < 70?"}
    S5I["Auto-create ReflectionProposal\nvia createReflectionProposal"]
    S5A --> S5B --> S5C
    S5C --> S5D & S5E & S5F & S5G --> S5H
    S5H -->|Yes| S5I
  end

  subgraph STORAGE["In-Memory Stores (reset on restart)"]
    ST1["apiAlerts  max 200"]
    ST2["errorTraces  max 500"]
    ST3["reflectionProposals  max 100"]
    ST4["webResearchResults  max 200"]
    ST5["accuracyTests  max 200"]
  end

  S1E & S1H & S1I --> ST1
  S2A & S2C --> ST2
  S2D & S3A --> ST3
  S4A --> ST4
  S5A --> ST5

  subgraph ERROR_CATEGORIES["10 Error Categories (KNOWN_ERROR_PATTERNS)"]
    EC["rate_limit · auth_failure · connection · timeout\nmissing_api · broken_link · validation\nserver_error · quota_exceeded · model_unavailable · unknown"]
  end
```

---

## 24. Orb Memory Architecture — Long-term + Short-term

```mermaid
graph TB
  subgraph LONG_TERM["Long-Term Memory  (orbMemory.ts)"]
    LT_STORE["const store: OrbMemory[]\nIn-memory · no TTL by default\nnewest at index 0"]
    
    LT_WRITE["recordOrbMemory input"]
    LT_SANITIZE["sanitizeMemoryText summary\ncontainsSensitiveText → log as safety_event\nsanitizeMemoryMetadata metadata"]
    LT_ID["Generate memoryId\nmem_{timestamp}_{6-char hex}"]
    LT_PUSH["store.unshift record"]
    
    LT_READ["getRecentOrbMemories args"]
    LT_FILTER["Filter: ownership · expiry · type"]
    LT_SORT["Sort: descending createdAt"]
    LT_LIMIT["Clamp limit: 1-100"]
    
    LT_SEARCH["searchOrbMemories args"]
    LT_SUBSTR["Case-insensitive substring\non summary · tags · type"]
    LT_TOP["Return top 20"]
    
    LT_SUMMARIZE["summarizeOrbMemoriesForPlanner"]
    LT_SEGMENT["Segment by type:\nfailed_workflow · successful_workflow · tool_feedback"]
    LT_HINTS["Generate hints:\n≥2 failures → avoid pattern\n≥2 successes → prioritize similar"]
    
    LT_WRITE --> LT_SANITIZE --> LT_ID --> LT_PUSH --> LT_STORE
    LT_READ --> LT_FILTER --> LT_SORT --> LT_LIMIT
    LT_SEARCH --> LT_SUBSTR --> LT_TOP
    LT_SUMMARIZE --> LT_SEGMENT --> LT_HINTS
    LT_STORE --> LT_READ & LT_SEARCH & LT_SUMMARIZE
  end

  subgraph SHORT_TERM["Short-Term Task Memory  (orbTaskMemory.ts)"]
    ST_STORE["const memoryEvents: OrbTaskMemoryEvent[]\nFIFO buffer · max 300\nnewest at index 0"]
    
    ST_WRITE["recordOrbTaskMemory event"]
    ST_UNSHIFT["memoryEvents.unshift\nif length > 300 → pop oldest"]
    
    ST_READ["getRecentOrbTaskMemory limit"]
    ST_SLICE["slice(0, clamp(1-50))"]
    
    ST_SUMMARIZE["summarizeRecentOrbTaskMemoryForPlanner"]
    ST_COMPACT["Truncate fields:\nintent → 140 chars\nfailedReason → 160 chars\nactionTypes → max 8"]
    
    ST_WRITE --> ST_UNSHIFT --> ST_STORE
    ST_STORE --> ST_READ --> ST_SLICE
    ST_STORE --> ST_SUMMARIZE --> ST_COMPACT
  end

  subgraph MEMORY_TYPES["OrbMemoryType (11 types)"]
    MT["user_preference · successful_workflow · failed_workflow\nprompt_pattern · model_preference · style_preference\ntool_feedback · claude_code_task · codex_task\nsafety_event · recovery_event"]
  end

  subgraph EVENT_FIELDS["OrbTaskMemoryEvent fields"]
    EF["taskId · planId · traceId\nuserIntent (user's original request)\noutcome: success|failure|cancelled|blocked\nfailedReason · usedEngine\nusedMultimodalPlanner: boolean\nactionTypes: string[]"]
  end

  subgraph PLANNER_INJECTION["Injected into Agent Planner Context"]
    PI1["recentOrbMemorySummary → from summarizeOrbMemoriesForPlanner\n→ count · recent events · optimization hints"]
    PI2["recentTaskMemorySummary → from summarizeRecentOrbTaskMemoryForPlanner\n→ count · recent outcomes with reasons"]
  end

  LT_HINTS --> PI1
  ST_COMPACT --> PI2
  PI1 & PI2 --> PLANNER["agentPlanner.runSchemaFirstAgentPlanner\nInjected as context blocks in system prompt"]

---

## 25. LoRA Fine-Tuning Pipeline (Replicate)

```mermaid
flowchart TD
  A([User submits LoRA training request]) --> B["INSERT fineTunedModels\nstatus=pending\nconfigJson: triggerWord · epochs · learningRate · datasetImages"]
  B --> C["INSERT backgroundJobs\njobType=model_training · status=queued"]
  C --> D([Return modelId to client])

  subgraph CRON["modelTrainingWorker.ts — cron every 5 min"]
    E1["recoverStuckTrainingJobs\nCheck jobs stuck > 15 min\nQuery Replicate for status recovery"]
    E2["processQueuedTrainingJobs\nTake next 5 queued jobs\nMark as processing · fire runLoraTrainingJob async"]
    E1 --> E2
  end

  D -.->|cron picks up| CRON

  E2 --> F["runLoraTrainingJob modelId"]
  F --> F1["UPDATE status=training · progress=5%"]
  F1 --> F2["Build ZIP from datasetImages\nParse .jpg/.png/.webp extensions"]
  F2 --> F3["storagePut lora-datasets/{userId}/{modelId}-{ts}.zip\n→ S3 / GCS"]
  F3 --> F4["replicate.predictions.create\nmodel: ostris/flux-dev-lora-trainer\ninput_images: zipUrl\nsteps = epochs × 30\ncaption_prefix = triggerWord"]
  F4 --> F5["Store predictionId in\nfineTunedModels.replicatePredictionId\nbackgroundJobs.resultJson"]

  F5 --> POLL["Polling loop every 30 s\nmax 60 min"]
  POLL --> F6["replicate.predictions.get predictionId"]
  F6 --> F7{Status?}
  F7 -->|processing| F8["Update progress 30%→90% linear estimate"]
  F8 --> POLL
  F7 -->|succeeded| F9["Extract output trainedLoraUrl\nUPDATE fineTunedModels status=ready\ntrained_lora_url · file_url"]
  F7 -->|failed / canceled| F10["UPDATE fineTunedModels status=failed\nUPDATE backgroundJobs status=failed"]
  F9 --> F11([Model ready for injection])
  F10 --> ERR([Training failed])

  subgraph INJECTION["Injection into generate.multimodal"]
    I1["Load fineTunedModel WHERE id = fineTunedModelId"]
    I2{status = ready?}
    I3["Extract triggerWord from configJson\nPrepend to prompt:\ntriggerWord + original_prompt"]
    I4["Extract trainedLoraUrl as LoRA weights"]
    I5["Route image to fal-ai/lora\nloraUrl = weights\nloraScale = loraWeight ?? 0.8"]
    I1 --> I2 -->|Yes| I3 --> I4 --> I5
    I2 -->|No| IERR([Error: model not ready])
  end

  F11 -.->|user selects model in generation| INJECTION
```

---

## 26. Vault System — Character & Scene Reference Injection

```mermaid
flowchart TD
  subgraph VAULT_CRUD["Vault CRUD  (server/db.ts + vault router)"]
    V1["vault.list\nFilter by itemType character/scene\nSearch by name/tags"]
    V2["vault.create\nStore imageUrl · fileKey · tags · metadata\nTable: consistencyVault"]
    V3["vault.update  name · tags · imageUrl · metadata"]
    V4["vault.delete  ownership check"]
    V5["vault.exportToAssets\nCopy to digital_asset_library"]
  end

  subgraph VAULT_DATA["consistencyVault table"]
    VD["id · userId · name\nitemType: character | scene\nimageUrl · fileKey\ntags JSON · metadata JSON\ncreatedAt · updatedAt"]
  end

  subgraph INJECTION["Vault Injection in generate.multimodal"]
    A[Input: vaultCharacterId] --> B[db.getVaultItem vaultCharacterId]
    B --> B1{itemType?}
    B1 -->|character + video| C1[Inject → characterRefUrl\nfirstFrameUrl]
    B1 -->|character + image| C2[Inject → styleReferenceUrl]

    D[Input: vaultSceneId] --> E[db.getVaultItem vaultSceneId]
    E --> F[Inject → vibeReferenceUrl]
  end

  subgraph DOWNSTREAM["Downstream Effect in Prompt Compilation"]
    G["compileElitePrompt injects reference image metadata"]
    H["Calculate visualWeight 0.0-1.0\nbased on number of reference types"]
    I["Generate controlNetParams\nfor downstream model integration"]
    G --> H --> I
  end

  C1 & C2 & F --> G
  VAULT_CRUD --> VAULT_DATA
```

---

## 27. generate.multimodal — Complete 9-Stage Pipeline

```mermaid
flowchart TD
  A([generate.multimodal called with jobId]) --> S1

  subgraph S1["Stage 1: Load Brain Config"]
    L1["Read userAiBrain from brainContext"]
    L2["Resolve engine per modality:\nimage: Gemini | Fal.ai\nvideo: Gemini Veo | Fal.ai\naudio: Gemini Lyria | Suno/Fal.ai\nvoice: Gemini TTS | ElevenLabs/Fal.ai"]
    L3["Calculate cost estimate via modelPricing"]
    L1 --> L2 --> L3
  end

  S1 --> S2

  subgraph S2["Stage 2: Safety Check"]
    SC1["checkSafety prompt\nGemini LLM · 15 s timeout\nJSON schema { safe, reason }"]
    SC2["Emit SSE: thought-update safety queued→processing"]
    SC3{safe?}
    SC4["Emit SSE: safety passed"]
    SC5["Refund points to user\nEmit SSE: error\nThrow TRPC error"]
    SC1 --> SC2 --> SC3
    SC3 -->|Yes| SC4
    SC3 -->|No| SC5
  end

  S2 --> S3

  subgraph S3["Stage 3: Vault Injection"]
    V1["If vaultCharacterId → db.getVaultItem\n→ inject characterRefUrl / styleReferenceUrl"]
    V2["If vaultSceneId → db.getVaultItem\n→ inject vibeReferenceUrl"]
  end

  S3 --> S4

  subgraph S4["Stage 4: Fine-Tuned Model Injection"]
    FM1["If fineTunedModelId → load model\nVerify status = ready"]
    FM2["Extract triggerWord from configJson\nPrepend to prompt: triggerWord + prompt"]
    FM3["Extract trainedLoraUrl as LoRA weights"]
    FM1 --> FM2 --> FM3
  end

  S4 --> S5

  subgraph S5["Stage 5: RAG Memory Retrieval"]
    R1["buildMemoryContext userId prompt\n3 s timeout · non-blocking\nSemantic context from past generations"]
  end

  S5 --> S6

  subgraph S6["Stage 6: Prompt Compilation"]
    PC1["compileElitePrompt:\n- Inject vibe card descriptions\n- Inject reference image metadata\n- Inject RAG memory context\n- Inject brain storyteller config\n- LLM expand prompt to 2048 tokens max"]
    PC2["Calculate visualWeight 0.0-1.0"]
    PC3["Generate controlNetParams"]
    PC4["Emit SSE: compile processing → completed\nwith compiledPrompt.length tokens"]
    PC1 --> PC2 --> PC3 --> PC4
  end

  S6 --> S7

  subgraph S7["Stage 7: Modality-Specific Generation"]
    G1{generationType?}
    G1 -->|image| GI["Gemini generateImage\nOR falDispatcher text-to-image\nIF LoRA → fal-ai/lora + loraScale\nIF refImage → image-to-image"]
    G1 -->|video| GV["Gemini generateVideoSync 5 min max\nOR falDispatcher video model\nSupports firstFrameUrl + lastFrameUrl anchors"]
    G1 -->|audio| GA["Gemini Lyria/MusicFX generateAudio\nOR Suno/Fal.ai audioCompiler\nLyrics + instrumental flag"]
    G1 -->|voice| GVo["Gemini TTS textToSpeech\nOR ElevenLabs/Fal.ai voiceCompiler\nSSML prosody + emotion profiling"]
    GI & GV & GA & GVo --> PU["persistExternalMediaUrl\nlocalizeResultUrls → S3/GCS"]
    PU --> RD["resultData: imageUrl / videoUrl / audioUrl / voiceUrl"]
  end

  S7 --> S8

  subgraph S8["Stage 8: History & Telemetry"]
    H1["INSERT generationHistory\nresultData · vaultIds · modelUsed · pointsDeducted\napiProvider · responseStatus"]
    H2["INSERT apiUsageLogs\npoints · engine · success/failure"]
    H3["INCREMENT fineTunedModel.usageCount async non-blocking"]
    H1 --> H2 --> H3
  end

  S8 --> S9

  subgraph S9["Stage 9: SSE Completion"]
    E1["Emit thought-update: generate completed"]
    E2["Emit thought-update: quota points breakdown"]
    E3["Emit thought-update: history queued"]
    E4["Emit progress: 100%"]
    E5["Emit complete: full thoughtChain array"]
    E1 --> E2 --> E3 --> E4 --> E5
  end

  S9 --> DONE([Client receives result via SSE])
```

---

## 28. Media Compiler Services — Voice / Audio / Video

```mermaid
graph TB
  subgraph VOICE["voiceCompiler.ts — SSML + Emotion Prosody"]
    VC_IN["Input: script · moodBlock · vibeCardIds\nvoiceId · rateOverride · enableHesitation"]
    VC_1["Map moodBlock → EmotionProfile\n13 profiles: serene · warm · dreamy · joyful\nmystical · nature · vintage · minimal\nmelancholy · dramatic · tender · anxious · contemplative"]
    VC_2["Segment script:\nnarration | dialogue | pause"]
    VC_3["Apply SSML prosody tags\nprosody rate pitch volume\nbreak time hesitation breaks"]
    VC_OUT["Output: ssml · plainText · emotionProfile\nsegmentCount · estimatedDurationSec\nbreakCount · compilationLog"]
    VC_IN --> VC_1 --> VC_2 --> VC_3 --> VC_OUT
  end

  subgraph AUDIO["audioCompiler.ts — Suno Music Structure"]
    AC_IN["Input: blocks AudioBlock[]\nfreePrompt · moodKeywords · lyrics\ntargetDurationSec · instrumental\nbpmOverride · forceStructure"]
    AC_1["Select template:\npop · ambient · edm · ballad\ncinematic · lofi · minimal"]
    AC_2["Generate sections:\nIntro · Verse 1 · Chorus · Drop\nBridge · Outro\n(energy level 1-5 per section)"]
    AC_3["Stack tags: max 4 per section bracket\nResolve style conflicts (e.g. heavy metal + ambient)"]
    AC_OUT["Output: prompt · styleTag · sections[]\nsectionCount · estimatedDurationSec\nhasConflictResolution · compilationLog"]
    AC_IN --> AC_1 --> AC_2 --> AC_3 --> AC_OUT
  end

  subgraph VIDEO["videoCompiler.ts — Camera Motion + Emotion Translation"]
    VVC_IN["Input: prompt · moodBlock\nfirstFrameUrl · lastFrameUrl\nfirstFrameDesc · lastFrameDesc\ncameraMode · aspectRatio"]
    VVC_1["Emotion-to-Action Translator\nMap emotion → actionVerbs · subjectBehaviors\nenvironmentalCues · suggestedCamera"]
    VVC_2["Camera Vector Binding\n16 modes: static · dolly_in/out · pan_left/right\ntilt_up/down · orbit · crane_up/down\ntracking · handheld · aerial · push_in · pull_out\nstability score 1-5 per mode"]
    VVC_3["Frame Anchoring:\nfirstFrameUrl → lock opening shot\nlastFrameUrl → lock closing shot"]
    VVC_4["Generate shots[] with transition safety\nPrevent jarring camera cuts"]
    VVC_OUT["Output: prompt · shots[] · shotCount\ncameraMode · cameraStabilityScore\nfirstFrameAnchor · lastFrameAnchor\nemotionTranslations · compilationLog"]
    VVC_IN --> VVC_1 --> VVC_2 --> VVC_3 --> VVC_4 --> VVC_OUT
  end

  subgraph GEMINI_MEDIA["geminiMedia.ts — Google Multimodal API"]
    GM_IMG["generateImage\nModels: imagen-3.0-generate-002 · imagen-3.0-fast · imagen-2.0\nParams: prompt · aspectRatio · negativePrompt · seed · numImages\n→ base64 images"]
    GM_VID["generateVideoSync\nModels: veo-2.0-generate-001 · veo-3.0-generate-preview\nParams: prompt · imageUrl firstFrame · duration 5-8s\nPolling up to 300 s → operationName → videoUrl"]
    GM_AUD["generateAudio\nModels: lyria-002 · musicfx-001\nParams: prompt · duration ≤30s · seed · temperature\n→ base64 audio"]
    GM_TTS["textToSpeech\nModels: gemini-2.5-flash-preview-tts · gemini-2.5-pro-preview-tts\nVoices: Zephyr · Puck · Charon · Kore · Fenrir · Aoede · Leda · Orus\nParams: text · voiceName · language · speakingRate 0.25-4.0 · pitch -20 to +20\n→ base64 audio"]
  end

  VC_OUT -->|ElevenLabs / Fal.ai TTS| GEMINI_MEDIA
  AC_OUT -->|Suno / Fal.ai audio| GEMINI_MEDIA
  VVC_OUT -->|Fal.ai / Gemini Veo| GEMINI_MEDIA
