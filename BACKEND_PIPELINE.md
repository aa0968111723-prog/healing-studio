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
