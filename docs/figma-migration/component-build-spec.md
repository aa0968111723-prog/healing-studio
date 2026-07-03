# 元件級 → Figma 建置藍圖（Component Build Spec）

> 目標：把 healing-studio 的 **56 個 shadcn UI 元件 + 10 個 design-kit primitives** 建成
> Figma Components，綁定既有的 **43 個 Variables**（`fileKey NhDt6VmAqNhuI4coDxZ41X`）。
> 本文是**可機械式執行的建置清單**——一旦 Figma seat 升到 Full，照此逐元件 `use_figma` 建置即可。

## ⛔ 兩個前置條件（務必先解）

1. **Figma seat 升級**：目前 **Collab seat = 6 次 MCP 呼叫/月（本月已用完）**，無法用 `use_figma` 建元件。
   需升到 **Full seat**（200 次/日）。約 56 元件 = 56+ 次 `use_figma`，Full seat 一天內做得完。
2. **先修 AIDV-971（token 同名衝突）**：design-kit primitives 綁的 `--muted`/`--surface-2/3` 與全域同名不同義。
   不先正名（改 `--dk-*`），design-kit 元件在 Figma 會綁到錯的變數。**shadcn 元件（Tier 1-3）不受此影響，可先建**。

## 綁定規則（所有元件共用）

| 程式屬性 | Figma Variable |
|---|---|
| 背景填色 | `color/primary`·`secondary`·`muted`·`accent`·`destructive`·`card`·`background` |
| 文字色 | `color/foreground`·`*-foreground`·`muted-foreground` |
| 邊框/描邊 | `color/border`·`input`·`ring` |
| 圓角 | `radius/sm`·`md`·`lg`·`xl`·`2xl`·`3xl`·`full` |
| 內距/間距/gap | `spacing/space-1..12`（4→192px） |

> 雙模式（Light/Dark）已在變數層處理——元件綁語意變數即自動支援暗色，無需建兩份。

## 建置順序（atoms → molecules → organisms）

### Tier 1 · Atoms（高重用，先建）— 16 件
| 元件 | 變體軸 | 關鍵綁定 |
|---|---|---|
| **Button** | variant(default/destructive/outline/secondary/ghost/link/healing) × size(default/sm/lg/icon/icon-sm/icon-lg) | bg=primary/secondary/destructive；text=*-foreground；border=input；radius/md；px=space-3/4/6 |
| **Badge** | variant(default/secondary/destructive/outline) | bg=primary/secondary/destructive；radius/full；px=space-2 |
| **Input** | — | bg=background；border=input；ring=ring；radius/md；px=space-3 |
| **Textarea** | — | 同 Input |
| **Label** | — | text=foreground |
| **Checkbox** | checked/unchecked | border=input；checked bg=primary；radius/sm |
| **Switch** | on/off | on bg=primary；off bg=input；radius/full |
| **Radio-group** | selected/unselected | border=input；dot=primary |
| **Toggle** | variant(default/outline) × size(default/sm/lg) | on bg=accent；radius/md |
| **Avatar** | — | bg=muted；radius/full |
| **Separator** | horizontal/vertical | bg=border |
| **Skeleton** | — | bg=muted；radius/md |
| **Spinner** | — | stroke=muted-foreground |
| **Progress** | — | track=muted；bar=primary；radius/full |
| **Slider** | — | track=muted；range=primary；thumb border=primary |
| **Kbd** | — | bg=muted；text=muted-foreground；radius/sm |

### Tier 2 · Molecules — 24 件
`Card`(tone: default/glass/raised · radius/2xl · py=space-6)、`Alert`(variant: default/destructive)、
`Dialog`、`Sheet`、`Drawer`、`Popover`、`Hover-card`、`Tooltip`（bg=popover · text=popover-foreground · radius/lg）、
`Select`、`Dropdown-menu`、`Context-menu`、`Menubar`、`Command`、`Accordion`、`Collapsible`、
`Tabs`（active bg=background · radius/md）、`Toggle-group`、`Input-otp`、`Input-group`(size 軸)、
`Empty-state`／`Empty`(variant)、`Error-state`、`Loading-card`、`Field`／`Form`、`Item`(variant×size)。

### Tier 3 · Organisms／複雜 — 16 件
`Table`、`Sidebar`(variant×size)、`Navigation-menu`、`Breadcrumb`、`Pagination`、`Carousel`、
`Calendar`、`Chart`（綁 color/chart-1..5）、`Resizable`、`Scroll-area`、`Aspect-ratio`、
`Button-group`、`Alert-dialog`、`Sonner`（toast）、`Accordion`。

### Tier 4 · design-kit primitives（**先修 AIDV-971**）— 10 件
`Button`、`Pill`、`Tag`、`Kbd`、`Eyebrow`、`Toggle`、`Meter`、`Spinner`、`Card`、`Input`
—— 綁 `.aidv-kit` scope 的 `--dk-surface*`/`--text-mute` 等（正名後）。須另建一組「design-kit」變數集合
（暖光黏土/珊瑚橘），與全站 shadcn 集合分開。

## 每元件 use_figma 建置流程（照 figma-generate-library 慣例）

每個元件一個 `use_figma` 呼叫：
1. 建 base component（auto-layout + 綁上表變數）
2. `combineAsVariants` 建全變體矩陣（矩陣 >30 組則拆 INSTANCE_SWAP）
3. 加 component properties（TEXT/BOOLEAN/INSTANCE_SWAP，如 icon slot）
4. `get_metadata` + `get_screenshot` 驗證
5. 選配：Code Connect 對回 `client/src/components/ui/<name>.tsx`

## 規模與額度估算
- 56 shadcn + 10 design-kit = 66 元件 ≈ **66–90 次 use_figma**（複雜元件拆多次）。
- Full seat（200/日）→ **一天內可全部建完**。
- 建議分 4 批（Tier 1→4），每批建完 `get_screenshot` 驗證再進下一批。

## 現況
- ✅ 43 Variables 已建（基礎層完成）
- ✅ 頁面骨架已建（Cover/Foundations/Button/Badge/Card/Input/Dialog）
- ⛔ 元件建置：**擋在 seat 額度**——升 Full seat 後照本藍圖執行

— 智能助手 🤖
