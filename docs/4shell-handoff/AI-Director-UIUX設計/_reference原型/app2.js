/* AI Director · app2.js — 素材來源選擇器 + 打包/初剪 rough-cut（擴充層）
   · 不改 app.js：以重新綁定 jumpStage / 包裝 renderVideo 的方式掛入。
   · 對回真實面：素材 assets.* → digital_asset_library；生成 generate.estimateCost→submitStudioJob→jobStatus→recordGenResult；
     配樂 proStudio.*；打包 job → background_jobs（8 jobType／5 status／斷路器，見 網站細節深掘.md §6）→ postGenActions 樞紐（§8）。
   · ❌待補（歸後端）：video_generation_sessions／video_segment_jobs／generateSegment、上傳與外部匯入的正式 procedure。 */

/* ---------- 擴充狀態 ---------- */
S.videoView='cockpit';
S.assetTab='gen';
S.assetGen={status:'idle',prompt:'',target:'',seed:0,touched:false};
S.upload={status:'empty',pct:0};
S.ext={status:'idle',url:'',err:''};
S.rough=null;

var ROUGH_AUDIO=[{id:'',name:'— 無配對 —'},{id:'m1',name:'禪意配樂 · ACE-Step'},{id:'m2',name:'旁白 · qwenTTS 沉穩男聲'},{id:'m3',name:'環境音 · 雪山風聲'}];
var UPLOAD_OK='jpg / png / webp / mp4 / mov / mp3 / wav';

/* ---------- 接管 jumpStage：步驟 → 對應工作畫面（非線性入口） ---------- */
jumpStage=function(i){var p=P();var g=counts();var steps=activeSteps();var st=steps[i]||{};
 if(st.id==='asset'&&g.blocked>0){toast('warn','跳階補齊','有角色未定版 — 先在確認門補精準參考');S.videoView='cockpit';S.tab='chars';p.stage=i;render();return;}
 p.stage=i;
 S.videoView=(st.id==='asset')?'asset':(st.id==='rough')?'rough':'cockpit';
 if(S.videoView==='rough')ensureRough();
 render();};

/* ---------- 包裝 renderVideo ---------- */
var __renderVideoBase=renderVideo;
renderVideo=function(){
 if(S.videoView==='asset'&&typeof assetScreen==='function')return vHead()+assetScreen();
 if(S.videoView==='rough'&&typeof roughScreen==='function'){ensureRough();return vHead()+roughScreen();}
 return __renderVideoBase();};
function vHead(){var p=P();var steps=activeSteps();
 var sb='<div class="card mb12"><div class="stages">';
 steps.forEach(function(s,i){sb+='<div class="stage-i '+(i<p.stage?'done':i===p.stage?'cur':'')+'"><button class="b" onclick="jumpStage('+i+')"><span class="n">'+(i<p.stage?'✓':i+1)+'</span>'+s.name+'</button>'+(i<steps.length-1?'<span class="sep"></span>':'')+'</div>';});
 sb+='<div style="flex:1"></div><button class="btn xs ghost" onclick="backCockpit()">返回駕駛艙</button><button class="btn xs ghost" onclick="openWF()">'+icon('wrench')+' 工作流</button></div></div>';
 return sb;}
function backCockpit(){S.videoView='cockpit';render();}

/* ============================================================
   1) 多模態素材創作 · 素材來源選擇器（站內生成／上傳自有／外部 AI 帶入）
   ============================================================ */
function assetScreen(){
 var tabs=[['gen','站內生成'],['upload','上傳自有'],['external','外部 AI 帶入']];
 var h='<div class="card pad" style="max-width:980px;margin:0 auto">';
 h+='<div class="h-row"><span class="ti">多模態素材創作 · 來源選擇</span><span class="cnt">SourceSelector</span></div>';
 h+='<div class="seg" role="tablist">';
 tabs.forEach(function(t){h+='<button role="tab" aria-selected="'+(S.assetTab===t[0])+'" class="'+(S.assetTab===t[0]?'on':'')+'" onclick="S.assetTab=\''+t[0]+'\';render()">'+t[1]+'</button>';});
 h+='</div><div class="hr"></div>';
 if(S.assetTab==='gen')h+=genPanel(); else if(S.assetTab==='upload')h+=uploadPanel(); else h+=extPanel();
 h+=newAssetsList();
 h+='<div class="flex gap8 mt14"><div style="flex:1"></div><button class="btn" onclick="gotoRough()">前往打包初剪 →</button></div>';
 return h+'</div>';}

function stateRow(txt){return '<div class="flex gap8 ai-c mt10"><div class="spin" style="width:22px;height:22px;border-width:2px"></div><span class="fz12 muted">'+txt+'</span></div>';}

/* --- 路徑 A：站內生成 --- */
function genPanel(){var p=P();var g=S.assetGen;var idle=p.shots.filter(function(s){return s.gen.status!=='done';});
 var h='<div class="eyebrow mb8">站內生成 · generate.estimateCost → submitStudioJob → jobStatus → recordGenResult</div>';
 h+='<div class="flex gap10 wrapf"><select class="input" style="max-width:250px;height:36px" onchange="S.assetGen.target=this.value">';
 h+='<option value="">（不綁定鏡頭 · 自由素材）</option>';
 idle.forEach(function(s){h+='<option value="'+s.id+'" '+(g.target===s.id?'selected':'')+'>'+s.no+' · '+s.title+'</option>';});
 h+='</select><select class="input" style="max-width:210px;height:36px"><option>Z-Image-Turbo（'+S.provider+'）</option><option>FLUX.1</option><option>Qwen-Image-Edit</option></select></div>';
 h+='<textarea class="input" style="margin-top:10px;height:84px" placeholder="輸入提示詞…（必填）" oninput="S.assetGen.prompt=this.value">'+(g.prompt||'')+'</textarea>';
 h+='<div class="flex gap8 mt10 ai-c"><button class="btn xs" onclick="smartPrompt()">智慧編譯提詞</button><span class="tip">先估成本 · 先扣後生成 · 失敗全額退還</span><div style="flex:1"></div>';
 if(g.status!=='estimating'&&g.status!=='generating')h+='<button class="btn primary sm" onclick="genAsset()">估算成本並生成</button>';
 h+='</div>';
 if(g.touched&&!(g.prompt||'').trim())h+='<div class="fz11" style="color:var(--bad);margin-top:6px">提示詞不可為空</div>';
 if(g.status==='estimating')h+=stateRow('估算成本中… director.estimateSegmentCost / generate.estimateCost');
 if(g.status==='generating')h+='<div class="gen-live mt10"><div class="scanbox"><div class="scan"></div></div><div><b class="fz12">生成中…</b><div class="mono fz11" style="color:var(--muted-2)">'+PROVIDERS[S.provider].label+' · seed '+g.seed+'</div><div class="jobchip mt6">background_jobs · jobType image ✅ · processing</div></div></div>';
 if(g.status==='done')h+='<div class="gen-done mt10"><div class="gd-thumb" style="background:'+frameBg(g.seed,0)+'"></div><div style="flex:1"><b class="fz13">生成完成</b><div class="mono fz11" style="color:var(--muted-2)">seed '+g.seed+' · '+S.provider+' · 已寫回資產庫（recordGenResult）'+(g.targetNo?' · 已綁定 '+g.targetNo:'')+'</div><div class="flex gap6 mt6"><button class="btn xs" onclick="saveGenToVault()">＋存入提示詞庫</button><button class="btn xs ghost" onclick="resetGen()">再生一張</button></div></div></div>';
 if(g.status==='error')h+='<div class="state error" style="min-height:auto;padding:16px"><div class="ds">生成失敗 · HTTP 504（'+S.provider+'）— 回退鏈 hf→gemini→fal · 積分已全額退還</div><button class="btn sm" onclick="genAsset()">重試</button></div>';
 return h;}
function genAsset(){var g=S.assetGen;
 if(!(g.prompt||'').trim()){g.touched=true;render();return;}
 var cost=PROVIDERS[S.provider].cost;var pts=Math.round(cost*1000);
 if(S.credits<pts&&S.provider!=='mock'){toast('bad','積分不足','需要 '+pts+' pts · 前往 /learn');return;}
 g.touched=false;g.status='estimating';render();
 setTimeout(function(){g.status='generating';g.seed=1000+Math.floor(Math.random()*9000);S.credits-=pts;
  toast('info','估算完成 · 先扣後生成','約 $'+cost+' → 已扣 '+pts+' pts（失敗全額退還）');render();
  setTimeout(function(){ if(S._faultProvider){g.status='error';S.credits+=pts;toast('bad','生成失敗 · 已全額退還',pts+' pts');render();return;}
   g.status='done';var p=P();g.targetNo='';
   if(g.target){var sh=p.shots.find(function(x){return x.id===g.target;});if(sh){sh.gen.status='done';sh.gen.provider=S.provider;g.targetNo=sh.no;}}
   p.assets.push({no:g.targetNo||'—',kind:'keyframe',model:'Z-Image-Turbo',provider:S.provider,cost:cost,_seed:g.seed,_src:'gen'});
   if(S.rough)S.rough=null;
   toast('ok','生成完成 · 已寫回資產庫',(g.targetNo?g.targetNo+' · ':'')+'seed '+g.seed);render();},1400);},700);}
function resetGen(){S.assetGen={status:'idle',prompt:'',target:'',seed:0,touched:false};render();}
function smartPrompt(){S.assetGen.prompt=((S.assetGen.prompt||'').trim()||'雪山晨霧空景')+'，療癒繪本風，暖色調，留白構圖，柔和晨光';toast('ok','智慧編譯提詞','已套用風格 token（同 compilePrompt）');render();}
function saveGenToVault(){var g=S.assetGen;
 S.vault.push({id:'v'+Date.now(),prompt:g.prompt,params:{model:'Z-Image-Turbo',seed:g.seed,size:'16:9',provider:S.provider},uses:1,status:S.autoDraft?'draft':'saved'});
 toast('ok','已存入提示詞庫 · 可重用','promptLibrary.create');render();}

/* --- 路徑 B：上傳自有 --- */
function uploadPanel(){var u=S.upload;
 var h='<div class="eyebrow mb8">上傳自有素材 · → digital_asset_library（sourceStudio: upload）｜⚠ 正式上傳 procedure 待補（歸後端，現走 R2/S3 直傳）</div>';
 h+='<div class="dropzone" onclick="simUpload(1)">⬆ 點擊或拖放檔案到此<br><span class="fz11 muted">支援 '+UPLOAD_OK+' · 單檔 ≤ 500MB</span></div>';
 h+='<div class="flex gap8 mt10"><button class="btn xs" onclick="simUpload(1)">模擬上傳成功</button><button class="btn xs ghost" onclick="simUpload(0)">模擬格式錯誤（.exe）</button></div>';
 if(u.status==='uploading')h+='<div class="mt10"><div class="meter"><i style="width:'+u.pct+'%"></i></div><div class="fz11 muted mt6">上傳中… '+u.pct+'%（驗證型別 → 計算雜湊 → 寫入資產庫）</div></div>';
 if(u.status==='done')h+='<div class="mt10"><span class="pill ok"><i class="d"></i>上傳完成 · 已入資產庫（我的）</span></div>';
 if(u.status==='error')h+='<div class="state error" style="min-height:auto;padding:14px"><div class="ds">格式不支援：<b>.exe</b> — 僅支援 '+UPLOAD_OK+'；單檔 ≤ 500MB</div><button class="btn sm" onclick="resetUpload()">重試</button></div>';
 return h;}
function simUpload(ok){var u=S.upload;if(u.status==='uploading')return;
 if(!ok){u.status='error';render();return;}
 u.status='uploading';u.pct=0;render();
 var t=setInterval(function(){u.pct+=20;
  if(u.pct>=100){clearInterval(t);u.status='done';P().assets.push({no:'—',kind:'video',model:'上傳素材.mp4',provider:'—',cost:0,_src:'upload'});if(S.rough)S.rough=null;
   toast('ok','上傳完成','已寫入 digital_asset_library（upload）');}
  render();},260);}
function resetUpload(){S.upload={status:'empty',pct:0};render();}

/* --- 路徑 C：外部 AI 帶入 --- */
function extPanel(){var e=S.ext;
 var h='<div class="eyebrow mb8">外部 AI 帶入 · → digital_asset_library（sourceStudio: external · 標「未經站內估算」）｜⚠ 匯入 procedure 待補（歸後端）</div>';
 h+='<div class="flex gap8"><input class="input" placeholder="貼上外部生成結果 URL（Midjourney / SD / 其他）" value="'+(e.url||'').replace(/"/g,'&quot;')+'" oninput="S.ext.url=this.value"><button class="btn primary sm" style="flex:none" onclick="extFetch()">帶入</button></div>';
 if(e.err)h+='<div class="fz11" style="color:var(--bad);margin-top:6px">'+e.err+'</div>';
 h+='<div class="fz11 muted mt6">外部素材不扣積分、不經站內估算；進分鏡仍走確認門。｜demo：URL 含「fail」可演示抓取失敗。</div>';
 if(e.status==='fetching')h+=stateRow('抓取來源中…（驗證 → 轉存 → 入庫）');
 if(e.status==='done')h+='<div class="mt10"><span class="pill ok"><i class="d"></i>已帶入</span> <span class="pill warn">外部來源 · 未經站內估算</span></div>';
 if(e.status==='error')h+='<div class="state error" style="min-height:auto;padding:14px"><div class="ds">無法取得來源（404）— 檢查連結，或改用「上傳自有」</div><button class="btn sm" onclick="extRetry()">重試</button></div>';
 return h;}
function extFetch(){var e=S.ext;var v=(e.url||'').trim();
 if(!/^https?:\/\/.+/.test(v)){e.err='URL 格式不正確（需 http:// 或 https://）';e.status='idle';render();return;}
 e.err='';e.status='fetching';render();
 setTimeout(function(){ if(v.indexOf('fail')>=0){e.status='error';render();return;}
  e.status='done';P().assets.push({no:'—',kind:'image',model:'外部AI素材',provider:'—',cost:0,_src:'external'});if(S.rough)S.rough=null;
  toast('ok','已帶入外部素材','digital_asset_library（external）· 未經站內估算');render();},900);}
function extRetry(){S.ext.status='idle';render();}

/* --- 本次素材清單 + 導航 --- */
function newAssetsList(){var as=P().assets.slice(-4).reverse();
 if(!as.length)return '<div class="hr"></div><div class="muted fz12">尚無素材 — 由上方任一來源加入。</div>';
 var h='<div class="hr"></div><div class="ctx-grp">'+icon('db')+' 專案素材（最新 '+as.length+' 筆）</div>';
 as.forEach(function(a){h+='<div class="listrow"><div class="le">'+(a.kind==='video'?'🎞':a.kind==='打包'?'📦':'🖼')+'</div><div style="flex:1;min-width:0"><b class="fz12">'+(a.no&&a.no!=='—'?a.no+' · ':'')+a.model+'</b><div class="mono" style="font-size:9.5px;color:var(--muted-2)">'+a.kind+' · '+(a._src==='upload'?'上傳自有':a._src==='external'?'外部AI':a._src==='gen'?'站內生成':a._src==='pack'?'打包輸出':a.provider)+'</div></div>'+(a._src==='external'?'<span class="pill warn" style="font-size:10px">外部</span>':'')+'</div>';});
 return h;}
function gotoRough(){var steps=activeSteps();var i=-1;steps.forEach(function(s,k){if(s.id==='rough')i=k;});
 if(i<0){toast('warn','「打包初剪」步驟未啟用','在工作流編輯器啟用後再進入');openWF();return;}
 jumpStage(i);}
function gotoAsset(){var steps=activeSteps();var i=-1;steps.forEach(function(s,k){if(s.id==='asset')i=k;});if(i>=0)jumpStage(i);}
function gotoGate(){var steps=activeSteps();var i=-1;steps.forEach(function(s,k){if(s.id==='gate')i=k;});S.videoView='cockpit';S.tab='shots';if(i>=0)P().stage=i;render();}

/* ============================================================
   2) 打包素材 + 簡易初剪 rough-cut
   ============================================================ */
function ensureRough(){var p=P();
 if(S.rough&&S.rough.projectId===S.projectId)return;
 var clips=[];
 p.shots.forEach(function(s){if(s.gen.status==='done')clips.push({id:'c_'+s.id,shotId:s.id,no:s.no,title:s.title,seed:s.seed,base:4,tin:0,tout:0,audio:''});});
 p.assets.forEach(function(a,k){if(a._src==='upload'||a._src==='external')clips.push({id:'a_'+k,shotId:null,no:'EXT',title:a.model,seed:7000+k*97,base:4,tin:0,tout:0,audio:''});});
 S.rough={projectId:S.projectId,clips:clips,prevIdx:-1,playing:false,exp:{status:'idle',pct:0}};}
function clipDur(c){return Math.max(.5,c.base-c.tin-c.tout);}
function roughTotal(){var t=0;S.rough.clips.forEach(function(c){t+=clipDur(c);});return t;}

function roughScreen(){var r=S.rough;var p=P();
 if(!r.clips.length)return '<div class="card"><div class="state"><div class="ico">🎬</div><div class="ti">時間軌還是空的</div><div class="ds">先到「多模態素材」生成或匯入素材；已生成（done）的鏡頭會自動進時間軌。</div><button class="btn primary" onclick="gotoAsset()">去多模態素材</button></div></div>';
 var unapproved=r.clips.filter(function(c){if(!c.shotId)return false;var s=p.shots.find(function(x){return x.id===c.shotId;});return s&&!s.approved;});
 var h='<div class="card pad">';
 h+='<div class="h-row"><span class="ti">打包素材 · 簡易初剪</span><span class="cnt">rough-cut v1 · 總長 '+roughTotal().toFixed(1)+'s · '+r.clips.length+' 段</span></div>';
 h+='<div class="flex gap8 ai-c wrapf">';
 h+='<button class="btn sm" onclick="previewRough()">'+(r.playing?'⏸ 停止預覽':'▶ 預覽')+'</button>';
 h+='<button class="btn sm gold" onclick="exportRough()" '+(r.exp.status==='running'?'disabled':'')+'>📦 匯出打包</button>';
 h+='<span class="tip">素材 assets.* · 配樂 proStudio.* · 打包 job → background_jobs（jobType 8 ✅ · status 5 ✅ · 斷路器 3連敗開路/冷卻10分）→ postGenActions</span></div>';
 if(unapproved.length)h+='<div class="unbound" style="margin:12px 0 0">'+icon('alert')+' '+unapproved.length+' 段關鍵影格未核准 — 鐵則：未核准不跑 i2v／不進打包　<button class="btn xs gold" onclick="gotoGate()">回確認門核准</button> <button class="btn xs ghost" onclick="excludeUnapproved()">排除未核准段</button></div>';
 var cur=(r.prevIdx>=0&&r.prevIdx<r.clips.length)?r.clips[r.prevIdx]:r.clips[0];
 h+='<div class="rc-preview mt10"><div class="rc-frame" style="background:'+frameBg(cur.seed,0)+'"><span class="seedtag">'+cur.no+' · '+cur.title+(r.playing?' · 預覽中':'')+'</span></div>';
 h+='<div class="rc-ph"><div class="rc-phbar" style="width:'+(r.playing&&r.prevIdx>=0?((r.prevIdx+1)/r.clips.length*100):0)+'%"></div></div></div>';
 h+='<div class="ctx-grp mt10">'+icon('layers')+' 影像軌 · 排序／裁切／配對音軌</div>';
 r.clips.forEach(function(c,i){var ap=true;if(c.shotId){var s=p.shots.find(function(x){return x.id===c.shotId;});ap=s?s.approved:true;}
  h+='<div class="rc-clip '+(r.prevIdx===i&&r.playing?'playing':'')+'">';
  h+='<div class="rc-thumb" style="background:'+frameBg(c.seed,0)+'"></div>';
  h+='<div style="flex:1;min-width:0"><div class="fz12"><span style="font-family:var(--f-mono);font-size:9.5px;color:var(--clay-deep);background:var(--clay-tint);padding:1px 6px;border-radius:6px">'+c.no+'</span> <b>'+c.title+'</b> '+(c.shotId?(ap?'<span class="pill ok" style="font-size:9px">已核准</span>':'<span class="pill warn" style="font-size:9px">未核准</span>'):'<span class="pill warn" style="font-size:9px">外部</span>')+'</div>';
  h+='<div class="flex gap8 ai-c mt6 wrapf fz11"><span class="mono muted">in</span><button class="btn xs" onclick="trimClip('+i+',1,-1)">−</button><span class="mono">'+c.tin.toFixed(1)+'</span><button class="btn xs" onclick="trimClip('+i+',1,1)">＋</button>';
  h+='<span class="mono muted">out</span><button class="btn xs" onclick="trimClip('+i+',0,-1)">−</button><span class="mono">'+c.tout.toFixed(1)+'</span><button class="btn xs" onclick="trimClip('+i+',0,1)">＋</button>';
  h+='<span class="pill mute" style="font-size:10px">有效 '+clipDur(c).toFixed(1)+'s</span>';
  h+='<select class="input" style="max-width:200px;height:30px;font-size:11.5px" onchange="pairAudio('+i+',this.value)">';
  ROUGH_AUDIO.forEach(function(a){h+='<option value="'+a.id+'" '+(c.audio===a.id?'selected':'')+'>'+(a.id?'🎵 ':'')+a.name+'</option>';});
  h+='</select></div></div>';
  h+='<div class="col-f gap6" style="flex:none"><button class="btn xs" onclick="moveClip('+i+',-1)" '+(i===0?'disabled':'')+'>↑</button><button class="btn xs" onclick="moveClip('+i+',1)" '+(i===r.clips.length-1?'disabled':'')+'>↓</button><button class="btn xs danger" onclick="removeClip('+i+')">✕</button></div>';
  h+='</div>';});
 var x=r.exp;
 if(x.status==='running')h+='<div class="mt10"><div class="meter"><i style="width:'+x.pct+'%"></i></div><div class="jobchip mt6">background_jobs · jobType zip_export ✅（成片段落編排另屬 ❌待補 generateSegment）· processing '+x.pct+'%</div></div>';
 if(x.status==='done')h+='<div class="rc-export mt10"><b>✓ 打包完成</b><div class="fz11 muted mt6">rough-cut v1 · MP4 1080p · '+r.clips.length+' 段 · 總長 '+roughTotal().toFixed(1)+'s · 已寫回資產庫＋專案 timeline（postGenActions 樞紐）</div><div class="flex gap8 mt6"><button class="btn xs gold" onclick="gotoGate()">前往確認修改</button><button class="btn xs ghost" onclick="closeExport()">關閉</button></div></div>';
 if(x.status==='failed')h+='<div class="state error" style="min-height:auto;padding:14px"><div class="ds">打包失敗（HTTP 504）— 3 連敗觸發<b>斷路器</b>開路、冷卻 10 分；卡住 15 分由 reaper 收割重試（≤3 次）（深掘 §6B）；積分已全額退還</div><button class="btn sm" onclick="exportRough()">重試</button></div>';
 return h+'</div>';}

function trimClip(i,isIn,d){var c=S.rough.clips[i];var k=isIn?'tin':'tout';var nv=Math.max(0,c[k]+d*0.5);
 var other=isIn?c.tout:c.tin;
 if(c.base-nv-other<0.5){toast('warn','裁切到底','有效長度最少 0.5s');return;}
 c[k]=nv;render();}
function moveClip(i,d){var a=S.rough.clips;var j=i+d;if(j<0||j>=a.length)return;var t=a[i];a[i]=a[j];a[j]=t;render();}
function removeClip(i){S.rough.clips.splice(i,1);toast('info','已移出時間軌','素材仍在資產庫');render();}
function pairAudio(i,v){S.rough.clips[i].audio=v;var a=null;ROUGH_AUDIO.forEach(function(x){if(x.id===v)a=x;});toast('ok','已配對音軌',S.rough.clips[i].no+' ↔ '+(a?a.name:'無')+'（proStudio.*）');}
function excludeUnapproved(){var p=P();var before=S.rough.clips.length;
 S.rough.clips=S.rough.clips.filter(function(c){if(!c.shotId)return true;var s=p.shots.find(function(x){return x.id===c.shotId;});return !s||s.approved;});
 toast('warn','已排除未核准段',(before-S.rough.clips.length)+' 段移出（仍在資產庫）');render();}
function previewRough(){var r=S.rough;
 if(r.playing){r.playing=false;r.prevIdx=-1;if(r._t)clearInterval(r._t);render();return;}
 if(!r.clips.length)return;
 r.playing=true;r.prevIdx=0;render();
 r._t=setInterval(function(){r.prevIdx++;
  if(r.prevIdx>=r.clips.length){clearInterval(r._t);r.playing=false;r.prevIdx=-1;toast('ok','預覽完成','rough-cut · '+roughTotal().toFixed(1)+'s');}
  render();},700);}
function exportRough(){var r=S.rough;var p=P();
 if(!r.clips.length){toast('warn','時間軌是空的','先加入素材');return;}
 var has=false;r.clips.forEach(function(c){if(c.shotId){var s=p.shots.find(function(x){return x.id===c.shotId;});if(s&&!s.approved)has=true;}});
 if(has){toast('bad','確認門擋下','有未核准段 — 回確認門核准，或排除未核准段');return;}
 var pts=50;
 if(S.credits<pts){toast('bad','積分不足','打包約需 '+pts+' pts');return;}
 toast('info','估算成本 · 先扣後生成','打包約 $0.05 → 已扣 '+pts+' pts（失敗全額退還）');S.credits-=pts;
 r.exp={status:'running',pct:0};render();
 var t=setInterval(function(){r.exp.pct+=12;
  if(S._faultProvider&&r.exp.pct>=48){clearInterval(t);r.exp.status='failed';S.credits+=pts;toast('bad','打包失敗 · 已全額退還',pts+' pts · 斷路器：3 連敗開路 · 冷卻 10 分');render();return;}
  if(r.exp.pct>=100){clearInterval(t);r.exp.status='done';
   p.assets.push({no:'—',kind:'打包',model:'rough-cut v1.mp4',provider:'—',cost:0.05,_src:'pack'});
   toast('ok','打包完成 · postGenActions','已寫回 digital_asset_library ＋ 專案 timeline');render();return;}
  render();},420);}
function closeExport(){S.rough.exp={status:'idle',pct:0};render();}

/* ---------- 套用擴充 ---------- */
render();
