/* AI Director · Reference 原型邏輯（設計系統 + 殼層 + /video） — 純 JS（避免內嵌長字串截斷） */
function orb(size){var s=size||40;return '<svg viewBox="0 0 100 100" width="'+s+'" height="'+s+'" aria-hidden="true">'
+'<defs><radialGradient id="og" cx="38%" cy="32%"><stop offset="0" stop-color="#DFF7F1"/><stop offset="42%" stop-color="#7FD9CF"/><stop offset="75%" stop-color="#2C7E77"/><stop offset="100%" stop-color="#1c4a52"/></radialGradient>'
+'<linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FDE08A"/><stop offset="100%" stop-color="#C8922F"/></linearGradient></defs>'
+'<circle class="orb-halo" cx="50" cy="50" r="46" fill="#3E9D94" opacity=".12"/><circle cx="50" cy="50" r="34" fill="url(#og)"/>'
+'<ellipse cx="42" cy="40" rx="11" ry="7" fill="#fff" opacity=".35"/>'
+'<g fill="url(#fg)"><circle cx="50" cy="44" r="6"/><path d="M38 66c0-9 5.6-15 12-15s12 6 12 15c0 2-24 2-24 0z"/></g>'
+'<g class="orb-ring-rot" fill="none" stroke="#E0AC4A" stroke-width="2.4" opacity=".9"><ellipse cx="50" cy="50" rx="40" ry="15" transform="rotate(-18 50 50)"/></g></svg>';}

var PROVIDERS={hf:{label:'Hugging Face',cost:0.012},gemini:{label:'Gemini 2.5',cost:0.020},fal:{label:'fal flux-pro',cost:0.040},mock:{label:'Mock',cost:0}};
var PERSONAS=[{id:'calm',zh:'平靜',en:'CALM'},{id:'creative',zh:'創意',en:'CREATIVE'},{id:'technical',zh:'技術',en:'TECHNICAL'}];
var SHELLS=[{id:'video',zh:'影片製作',en:'VIDEO',emoji:'🎬'},{id:'social',zh:'社群圖文',en:'SOCIAL',emoji:'🖼'},{id:'learn',zh:'學習文件',en:'LEARN',emoji:'📚'},{id:'settings',zh:'設定',en:'SETTINGS',emoji:'⚙'}];
var GRADE={precise:'✅ 精準',estimate:'⚠ 估算',unconfirmed:'⚠ 未確認'};
var DEFAULT_WF=[{id:'intent',name:'腳本意圖',req:true,on:true},{id:'entry',name:'非線性入口',req:false,on:true},{id:'asset',name:'多模態素材',req:true,on:true},{id:'rough',name:'打包初剪',req:false,on:true},{id:'gate',name:'確認修改',req:true,on:true},{id:'done',name:'完成專案',req:true,on:true}];
var STEP_LIB=[{id:'world',name:'世界觀設定'},{id:'lora',name:'角色 LoRA 訓練'},{id:'voice',name:'配音/配樂'},{id:'publish',name:'發佈/精選'},{id:'review',name:'同儕審閱'}];

function seedShots(){return [
 {id:'sh1',no:'S01',title:'雪山道遠景',route:'text',chars:[],seed:1042,approved:true,stale:false,gen:{status:'done',provider:'hf',variant:0}},
 {id:'sh2',no:'S02',title:'密勒日巴洞口',route:'ref',chars:['c_mila'],seed:2087,approved:true,stale:false,gen:{status:'done',provider:'hf',variant:0}},
 {id:'sh3',no:'S03',title:'惹瓊巴登場',route:'ref',chars:['c_rech'],seed:3120,approved:false,stale:false,gen:{status:'idle',variant:0}},
 {id:'sh4',no:'S04',title:'師徒相見',route:'ref',chars:['c_mila','c_rech'],seed:4205,approved:false,stale:false,gen:{status:'idle',variant:0}},
 {id:'sh5',no:'S05',title:'山神示現',route:'ref',chars:['c_god'],seed:5310,approved:false,stale:false,gen:{status:'idle',variant:0}},
 {id:'sh6',no:'S06',title:'村莊全景',route:'text',chars:[],seed:6033,approved:false,stale:false,gen:{status:'idle',variant:0}}
];}
var S={
 shell:'video',view:'auto',tab:'shots',provider:'hf',theme:'light',persona:'creative',
 credits:1379,autoDraft:false,cmdkOpen:false,guided:null,projOpen:false,provOpen:false,
 dmode:'chat',hideSb:false,orbOpen:false,orbTab:'本頁',bubble:null,bubbleShown:false,wfOpen:false,
 workflow:DEFAULT_WF.map(function(x){return {id:x.id,name:x.name,req:x.req,on:x.on};}),
 projectId:'p_rechungpa',
 projects:{
  p_rechungpa:{emoji:'🏔',name:'惹瓊巴傳',type:'影片',logline:'雪山師徒的傳法之路。',stage:2,tokens:2410,
    chars:[{id:'c_mila',emoji:'🧙',name:'密勒日巴',grade:'precise',locked:true,lora:'已完成',refs:5},
           {id:'c_rech',emoji:'🧘',name:'惹瓊巴',grade:'estimate',locked:false,lora:'未訓練',refs:0},
           {id:'c_god',emoji:'⛰',name:'山神',grade:'unconfirmed',locked:false,lora:'未訓練',refs:0}],
    scenes:[{name:'雪山道',kind:'exterior',locked:true},{name:'閉關洞',kind:'interior',locked:true},{name:'村莊',kind:'named-place',locked:false}],
    shots:seedShots(),
    notes:[{t:'S04 師徒相見要逆光，金邊輪廓。'},{t:'整體色溫偏暖，呼應療癒基調。'}],
    assets:[{no:'S01',kind:'keyframe',model:'Z-Image-Turbo',provider:'hf',cost:0.012},{no:'S02',kind:'keyframe',model:'Qwen-Image-Edit',provider:'hf',cost:0.015}],
    sources:[{si:'💾',sn:'禪修世界觀 v1',sm:'worldbuilding',fresh:true},{si:'💾',sn:'30 秒禪修分鏡',sm:'world_storyboards',fresh:true},{si:'☁',sn:'淡大腳本（Drive）',sm:'data_source',fresh:false},{si:'☁',sn:'教材參考（Notion）',sm:'teaching_materials',fresh:false}]},
  p_zen:{emoji:'🪷',name:'每日禪語',type:'社群',logline:'每日一句正念開示卡。',stage:1,tokens:980,chars:[],scenes:[],shots:[],notes:[],assets:[],sources:[{si:'☁',sn:'正念語錄',sm:'news/sense',fresh:true}]},
  p_blank:{emoji:'✨',name:'未命名創作',type:'混合',logline:'（尚未建立上下文）',stage:0,tokens:0,chars:[],scenes:[],shots:[],notes:[],assets:[],sources:[]}
 },
 vault:[]
};
function P(){return S.projects[S.projectId];}
function activeSteps(){return S.workflow.filter(function(s){return s.on;});}

function gateOf(shot,chars){
 if(shot.route==='text'||shot.chars.length===0) return 'ready';
 var refs=shot.chars.map(function(id){return chars.find(function(c){return c.id===id;});}).filter(Boolean);
 if(refs.length===0) return 'ready';
 var ok=refs.filter(function(c){return c.grade==='precise'&&c.locked;}).length;
 return ok===refs.length?'ready':ok===0?'blocked':'partial';
}
function counts(){var p=P();var r={ready:0,partial:0,blocked:0};p.shots.forEach(function(s){r[gateOf(s,p.chars)]++;});return r;}
function frameBg(seed,variant){var h1=(seed*47+(variant||0)*97)%360,h2=(h1+38)%360,h3=(h2+46)%360;return 'radial-gradient(120% 120% at 30% 20%,hsl('+h1+' 52% 72%),hsl('+h2+' 46% 58%) 55%,hsl('+h3+' 40% 46%))';}

function toast(kind,title,desc){var id='t'+Date.now()+Math.random();S._toasts=S._toasts||[];S._toasts.push({id:id,kind:kind,title:title,desc:desc});renderToasts();setTimeout(function(){S._toasts=S._toasts.filter(function(t){return t.id!==id;});renderToasts();},4600);}
function renderToasts(){var ICO={ok:'✓',warn:'!',bad:'✕',info:'i'};document.getElementById('toasts').innerHTML=(S._toasts||[]).map(function(t){return '<div class="toast '+t.kind+'" onclick="dismissToast(\''+t.id+'\')"><div class="ti">'+ICO[t.kind]+'</div><div><div class="tt">'+t.title+'</div>'+(t.desc?'<div class="td">'+t.desc+'</div>':'')+'</div></div>';}).join('');}
function dismissToast(id){S._toasts=(S._toasts||[]).filter(function(x){return x.id!==id;});renderToasts();}

function render(){
 var p=P();var sh=SHELLS.find(function(x){return x.id===S.shell;});
 var h='<div class="app"><nav class="rail"><div class="logo" title="首頁" onclick="go(\'home\')">'+orb(42)+'</div>';
 SHELLS.forEach(function(x){h+='<button class="sw '+(S.shell===x.id?'on':'')+'" onclick="go(\''+x.id+'\')"><span class="gi">'+x.emoji+'</span><span class="lb">'+x.zh+'</span><span class="en">'+x.en+'</span>'+(x.id==='learn'&&S.credits<120?'<span class="badge">!</span>':'')+'</button>';});
 h+='<div class="rail-sp"></div><button class="mini" title="命令面板 ⌘K" onclick="openCmdk()">'+icon('command')+'</button></nav>';
 h+='<div class="main"><header class="topbar"><div class="crumb"><span class="ce">'+(S.shell==='home'?'🚪':sh.emoji)+'</span><span class="sh">'+(S.shell==='home'?'AI Director':sh.zh)+'</span><span class="sub">'+(S.shell==='home'?'START':sh.en)+'</span></div>';
 h+='<div style="position:relative"><div class="projpill" onclick="S.projOpen=!S.projOpen;render()"><span class="pe">'+p.emoji+'</span><span class="pn">'+p.name+'</span><span class="cf">'+icon('layers')+' '+(p.tokens/1000).toFixed(1)+'k</span>'+icon('chevron')+'</div>'+(S.projOpen?projDrop():'')+'</div>';
 h+='<div class="sp"></div><div style="position:relative"><div class="provchip" onclick="S.provOpen=!S.provOpen;render()" title="生成引擎"><span class="dot"></span><span class="pv">'+S.provider+'</span></div>'+(S.provOpen?provDrop():'')+'</div>';
 h+='<button class="tbtn hideSm '+(S.credits<120?'down':'')+'" onclick="toast(\'info\',\'積分餘額\',\''+S.credits+' pts · Studio Pro\')">'+icon('coin')+' '+S.credits.toLocaleString()+'</button>';
 h+='<button class="tbtn" onclick="openCmdk()">'+orb(20)+' 光球 <kbd>⌘K</kbd></button></header>';
 h+='<div class="content"><div class="wrap" id="wrap">'+renderShell()+'</div></div>';
 h+='<nav class="mnav">';
 SHELLS.slice(0,2).forEach(function(x){h+='<a class="'+(S.shell===x.id?'on':'')+'" onclick="go(\''+x.id+'\')"><span class="mi">'+x.emoji+'</span>'+x.zh+'</a>';});
 h+='<a class="fab" onclick="openCmdk()"><span class="mi">'+orb(26)+'</span></a>';
 SHELLS.slice(2).forEach(function(x){h+='<a class="'+(S.shell===x.id?'on':'')+'" onclick="go(\''+x.id+'\')"><span class="mi">'+x.emoji+'</span>'+x.zh+'</a>';});
 h+='</nav></div>'+orbAssistant()+'</div>';
 document.getElementById('app').innerHTML=h;
}
function projDrop(){var h='<div class="card pdrop"><div class="ctx-grp">切換專案（脊椎）</div>';
 Object.keys(S.projects).forEach(function(id){var pr=S.projects[id];h+='<div class="src" onclick="setProject(\''+id+'\')" style="cursor:pointer"><div class="si">'+pr.emoji+'</div><div style="flex:1;min-width:0"><div class="sn">'+pr.name+'</div><div class="sm">'+pr.type+' · '+pr.shots.length+' 鏡 · '+pr.chars.length+' 角色</div></div>'+(id===S.projectId?icon('check'):'')+'</div>';});
 return h+'<button class="btn sm block" style="margin-top:8px" onclick="toast(\'ok\',\'已建立新專案\',\'未命名創作\');S.projOpen=false;render()">＋ 開新專案</button></div>';}
function provDrop(){var h='<div class="card pdrop" style="width:240px;left:auto;right:0"><div class="ctx-grp">生成 Provider（B 案）</div>';
 Object.keys(PROVIDERS).forEach(function(id){var m=PROVIDERS[id];h+='<div class="src" onclick="setProvider(\''+id+'\')" style="cursor:pointer"><div class="si">'+(id==='hf'?'✋':id==='gemini'?'👁':id==='fal'?'🔁':'🧪')+'</div><div style="flex:1"><div class="sn" style="text-transform:uppercase;font-family:var(--f-mono)">'+id+'</div><div class="sm">'+m.label+' · $'+m.cost+'/張</div></div>'+(id===S.provider?icon('check'):'')+'</div>';});
 return h+'</div>';}

function renderShell(){
 if(S.shell==='home') return renderHome();
 if(S.shell==='video') return renderVideo();
 var meta=SHELLS.find(function(x){return x.id===S.shell;});
 return '<div class="placeholder-shell"><div class="card pad"><div class="state"><div class="ico">'+meta.emoji+'</div><div class="ti">'+meta.zh+' · '+meta.en+'</div><div class="ds">此 shell 由<b>平行工作階段</b>設計中，共用同一條脊椎與這套亮色設計系統。<br>切回 <a onclick="go(\'video\')" style="color:var(--clay-deep);font-weight:600">🎬 影片製作</a> 看完整旗艦原型。</div></div></div></div>';
}
function renderHome(){var cards=[['🎬','做一支完整影片','世界觀→腳本→分鏡→生成→成片','video'],['🖼','做社群海報/圖文','brief→品牌鎖→多尺寸發佈','social'],['📚','研究/學怎麼用','Sonar 研究＋115 模型','learn'],['⚙','設定/管理後台','引擎/權限/觀測','settings']];
 var h='<div style="max-width:1000px;margin:0 auto;padding:30px 0"><div class="flex ai-c" style="gap:32px;flex-wrap:wrap"><div>'+orb(180)+'</div><div style="flex:1;min-width:280px"><div class="eyebrow">禪 ZEN × 宇宙 COSMIC × 多模態</div><h1 style="font-size:48px;margin:8px 0">AI <span style="color:var(--clay-deep)">Director</span></h1><p class="lead">一條後端脊椎，四個各自獨立的前端系統——像 Claude 與 Claude Code。</p><div class="flex gap10 mt14"><button class="btn gold" onclick="openGuided()">引導式：貼長腳本一鍵拆片</button><button class="btn" onclick="openCmdk()">開啟光球 ⌘K</button></div></div></div><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));margin-top:28px">';
 cards.forEach(function(c){h+='<button class="card pad hover" style="text-align:left;cursor:pointer" onclick="go(\''+c[3]+'\')"><div style="font-size:28px">'+c[0]+'</div><div style="font-family:var(--f-serif);font-weight:600;margin-top:6px;font-size:15px">'+c[1]+'</div><p class="lead" style="font-size:12.5px;margin:6px 0 0">'+c[2]+'</p></button>';});
 return h+'</div></div>';}

function renderVideo(){
 var p=P();var g=counts();var steps=activeSteps();
 var insp='<div class="inspector"><span class="il">'+icon('gauge')+' 狀態檢視</span><div class="seg">';
 ['auto','empty','loading','error'].forEach(function(v){var lb={auto:'自動',empty:'空狀態',loading:'載入',error:'錯誤'};insp+='<button class="'+(S.view===v?'on':'')+'" onclick="S.view=\''+v+'\';render()">'+lb[v]+'</button>';});
 insp+='</div><span class="tip">切換預覽 cockpit 四態</span></div>';
 var sb='<div class="card mb12"><div class="stages">';
 steps.forEach(function(s,i){sb+='<div class="stage-i '+(i<p.stage?'done':i===p.stage?'cur':'')+'"><button class="b" onclick="jumpStage('+i+')"><span class="n">'+(i<p.stage?'✓':i+1)+'</span>'+s.name+(s.req?'':' <span class="tip">可選</span>')+'</button>'+(i<steps.length-1?'<span class="sep"></span>':'')+'</div>';});
 sb+='<div style="flex:1"></div><button class="btn xs ghost" onclick="openWF()" title="自訂工作流步驟">'+icon('wrench')+' 工作流</button><button class="btn sm gold" onclick="openGuided()">引導式創作</button><button class="btn sm primary" onclick="scheduleReady()">生成就緒鏡（'+g.ready+'）</button></div></div>';
 if(S.view==='empty') return insp+sb+'<div class="card"><div class="state"><div class="ico">🎬</div><div class="ti">這個專案還是空的</div><div class="ds">貼上你的長腳本，光球會幫你拆成幕、分鏡與角色。</div><button class="btn primary" onclick="openGuided()">開始引導式創作</button></div></div>';
 if(S.view==='loading') return insp+sb+'<div class="card"><div class="state"><div class="spin"></div><div class="ti">載入導演 cockpit<span class="dots"></span></div><div class="ds">向脊椎請求專案上下文…</div></div></div>';
 if(S.view==='error') return insp+sb+'<div class="card"><div class="state error"><div class="ico">'+icon('alert')+'</div><div class="ti">導演台連線中斷</div><div class="ds">tRPC <code>director.*</code> 無回應。</div><button class="btn" onclick="S.view=\'auto\';render()">重試</button></div></div>';
 return insp+sb+'<div class="cockpit"'+(S.hideSb?' style="grid-template-columns:300px 1fr"':'')+'><div class="col left">'+colLeft()+'</div><div class="col" style="order:2">'+colCenter(g)+'</div>'+(S.hideSb?'':'<div class="col right" style="order:3">'+colRight()+'</div>')+'</div>';
}
function colLeft(){var p=P();var h='<div class="card"><div class="dcol-h">'+icon('layers')+'<b>專案 · 上下文</b></div><div class="dcol-b"><div class="lead" style="font-size:13px"><b>'+p.emoji+' '+p.name+'</b><br><span class="muted" style="font-size:12px">'+p.logline+'</span></div><div class="ctx-grp">'+icon('db')+' 已索引上下文</div>';
 h+=(p.sources.length?p.sources.map(function(s){return '<div class="src"><div class="si">'+s.si+'</div><div style="flex:1;min-width:0"><div class="sn">'+s.sn+'</div><div class="sm">'+s.sm+'</div></div><span class="fresh '+(s.fresh?'fok':'fstale')+'">'+(s.fresh?'新鮮':'過期')+'</span></div>';}).join(''):'<div class="muted" style="font-size:12px;padding:8px 0">（尚無索引來源）</div>');
 return h+'<div class="packet"><div class="pt"><span>Context Packet</span><span class="mono" style="font-size:10px;color:var(--teal-deep)">'+(p.tokens/1000).toFixed(1)+'k / 8k</span></div><div class="meter"><i style="width:'+Math.min(100,p.tokens/8000*100)+'%"></i></div><div class="flex jc-b mt10" style="font-size:11px"><span class="muted">TTL 30:00 · 擁有者可讀寫</span><button class="btn xs" onclick="toast(\'ok\',\'Context Packet 已重建\',\'Deterministic→Cache→RAG\')">重建</button></div></div></div></div>';}
function colCenter(g){var dmode=S.dmode||'chat';var modes=[['chat','對話模式'],['script','腳本分析'],['plan','規劃模式'],['world','世界觀']];var body;
 if(dmode==='world') body=worldPanel();
 else if(dmode==='script') body='<div style="padding:16px"><div class="eyebrow">腳本分析</div><p class="lead" style="font-size:12.5px">逐段拆解：幕／鏡／角色／場景／route(ref·text)／成本估算。對映 <span class="mono">director.analyzeScriptOverview</span>。</p><button class="btn sm primary" style="margin-top:8px" onclick="openGuided()">貼長腳本拆解</button></div>';
 else if(dmode==='plan') body='<div style="padding:16px"><div class="eyebrow">規劃模式</div><p class="lead" style="font-size:12.5px">里程碑與工作流規劃（<span class="mono">director.planning*</span>）。先估成本、走確認門，再排程生成。</p></div>';
 else{var ms=(S._msgs||defaultMsgs()).map(msgHtml).join('');body='<div class="chat"><div class="msgs" id="msgs">'+ms+'</div><div class="chat-in"><textarea class="input" id="chatbox" placeholder="與導演台對話（CO-STAR × RAG）…" onkeydown="chatKey(event)"></textarea><button class="send" onclick="sendChat()" title="送出">'+icon('send')+'</button></div></div>';}
 var h='<div class="card"><div class="persona">';
 PERSONAS.forEach(function(pe){h+='<button class="p '+pe.id+' '+(S.persona===pe.id?'on':'')+'" onclick="S.persona=\''+pe.id+'\';render()"><div class="pn">'+pe.zh+'</div><div class="pd">'+pe.en+'</div></button>';});
 h+='</div><div class="dmode">';
 modes.forEach(function(m){h+='<button class="'+(dmode===m[0]?'on':'')+'" onclick="S.dmode=\''+m[0]+'\';render()">'+m[1]+'</button>';});
 h+='<div style="flex:1"></div><button class="btn xs ghost" onclick="S.hideSb=!S.hideSb;render()">'+(S.hideSb?'顯示':'隱藏')+' Storyboard</button></div>';
 h+='<div class="unbound">'+icon('alert')+' 未綁定專案則不保存 · 對話→腳本→世界觀→分鏡→生成，全部在這頁完成</div>';
 return h+gateCard(g)+body+'</div>';}
function chatKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}}
function defaultMsgs(){return [{role:'ai',who:'COMMANDER',text:'已載入「惹瓊巴傳」。鐵則：角色未定版不進分鏡、關鍵影格未核准不跑 i2v、媒體生成前先估成本。要先補「惹瓊巴」的精準參考嗎？'}];}
function msgHtml(m){return '<div class="msg '+m.role+'">'+(m.role==='ai'?'<div class="av">'+icon('brain')+'</div>':'')+'<div><div class="who">'+(m.who||(m.role==='me'?'你':'AI'))+'</div><div class="bub">'+m.text+'</div></div></div>';}
function gateCard(g){var p=P();var blocker=p.chars.find(function(c){return !(c.grade==='precise'&&c.locked);});
 var h='<div class="gate"><div class="gh">'+icon('lock')+' 確認門 · GATE</div><div class="gb"><div class="counts"><div class="bigcount ok"><b>'+g.ready+'</b><span>可量產</span></div><div class="bigcount warn"><b>'+g.partial+'</b><span>部分待補</span></div><div class="bigcount bad"><b>'+g.blocked+'</b><span>全待補</span></div></div>';
 h+=(blocker?'<div class="row"><span class="pill warn">'+GRADE[blocker.grade]+'</span><span style="flex:1;font-size:12.5px">「'+blocker.name+'」未定版 — 先補精準參考</span><button class="btn gold xs" onclick="uploadRef(\''+blocker.id+'\')">上傳參考照</button></div>':'<div class="row" style="color:var(--ok)">✅ 所有角色已定版 · 可進量產</div>');
 return h+'<div class="gate-rule">角色未定版不進分鏡 · 關鍵影格未核准不跑 i2v · 媒體生成前先估成本</div></div></div>';}
function colRight(){var tabs=[['shots','分鏡'],['chars','角色'],['scenes','場景'],['notes','筆記'],['assets','資產'],['prompts','提示詞']];var h='<div class="card"><div class="dbtabs">';
 tabs.forEach(function(t){h+='<button class="'+(S.tab===t[0]?'on':'')+'" onclick="S.tab=\''+t[0]+'\';render()">'+t[1]+'</button>';});
 return h+'</div>'+tabBody()+'</div>';}
function tabBody(){var p=P();
 if(S.tab==='shots') return '<div class="shots">'+p.shots.map(shotCard).join('')+'</div>';
 if(S.tab==='chars') return '<div class="roster">'+(p.chars.map(charCard).join('')||emptyMini('還沒有角色'))+'</div>';
 if(S.tab==='scenes') return '<div class="roster">'+(p.scenes.map(function(s){return '<div class="listrow"><div class="le">'+(s.kind==='interior'?'🏠':s.kind==='named-place'?'📍':'🌄')+'</div><div style="flex:1"><b style="font-size:13px">'+s.name+'</b></div>'+(s.locked?'<span class="pill ok">已鎖定</span>':'<span class="pill mute">未鎖</span>')+'</div>';}).join('')||emptyMini('還沒有場景'))+'</div>';
 if(S.tab==='notes') return '<div class="roster">'+(p.notes.map(function(n){return '<div class="listrow"><div class="le">'+icon('note')+'</div><div style="flex:1;font-size:12.5px">'+n.t+'</div></div>';}).join('')||emptyMini('還沒有筆記'))+'</div>';
 if(S.tab==='assets') return '<div class="roster">'+(p.assets.map(function(a){return '<div class="listrow"><div class="le">🖼</div><div style="flex:1"><b style="font-size:12.5px">'+a.no+' · '+a.model+'</b><div class="mono" style="font-size:9.5px;color:var(--muted-2)">'+a.kind+' · '+a.provider+' · $'+a.cost+'</div></div></div>';}).join('')||emptyMini('還沒有資產'))+'</div>';
 if(S.tab==='prompts') return vaultBrowser();
 return '';
}
function emptyMini(t){return '<div class="state" style="min-height:160px;padding:24px"><div class="ico" style="width:48px;height:48px;font-size:22px">✨</div><div class="ds">'+t+'</div></div>';}
function shotCard(s){var p=P();var g=gateOf(s,p.chars);var st=s.gen.status;
 var blocked=s.chars.map(function(id){return p.chars.find(function(c){return c.id===id;});}).find(function(c){return c&&!(c.grade==='precise'&&c.locked);});
 var thumb;
 if(st==='done') thumb='<div class="gimg" style="background:'+frameBg(s.seed,s.gen.variant)+';'+(s.stale?'filter:grayscale(.4) brightness(.95) sepia(.1)':'')+'"></div><span class="seedtag">seed '+s.seed+' · '+s.gen.provider+'</span>'+(s.stale?'<div class="gen"><span class="pill warn">過期待重生</span></div>':'');
 else if(st==='generating') thumb='<div class="scan"></div><div class="gen"><div class="spin" style="width:34px;height:34px"></div><span style="font-size:11px;color:var(--muted)">生成中…</span></div>';
 else if(st==='error') thumb='<div class="gen"><span class="pill bad">生成失敗</span></div>';
 else thumb='<div class="ph">'+(s.route==='text'?'🌄 空景 · 文字生成':'🔒 角色 · 參考圖轉繪')+'<br><span class="mono" style="font-size:10px">seed '+s.seed+'</span></div>';
 var a='';
 if((st==='idle'||st==='queued')&&g==='ready') a='<button class="btn xs primary" onclick="genShot(\''+s.id+'\')">生成</button>';
 else if(st==='idle'||st==='queued') a='<span class="tag">待補：'+(blocked?blocked.name:'角色')+'</span>';
 else if(st==='done'&&!s.stale&&!s.approved) a='<button class="btn xs" onclick="genShot(\''+s.id+'\',true)">同seed重生</button><button class="btn xs gold" onclick="approveShot(\''+s.id+'\')">核准</button>'+saveBtn(s);
 else if(st==='done'&&!s.stale&&s.approved) a='<button class="btn xs" onclick="genShot(\''+s.id+'\',true)">同seed重生</button>'+saveBtn(s);
 else if(st==='done'&&s.stale) a='<button class="btn xs gold" onclick="genShot(\''+s.id+'\',true)">重生（已過期）</button>';
 else if(st==='error') a='<button class="btn xs" onclick="genShot(\''+s.id+'\')">重試</button>';
 return '<div class="shot '+(s.stale?'stale':'')+' '+(st==='error'?'error':'')+'"><div class="thumb">'+thumb+'</div><div class="meta"><div class="sn"><span class="no">'+s.no+'</span>'+s.title+'</div><div class="st"><span class="pill '+(g==='ready'?'ok':g==='partial'?'warn':'bad')+'">'+(g==='ready'?'可量產':g==='partial'?'部分待補':'全待補')+'</span>'+(s.approved?'<span class="pill info">已核准</span>':'')+a+'</div></div></div>';}
function saveBtn(s){var saved=(S.vault||[]).some(function(v){return v.fromShot===s.id;});return saved?'<span class="pill ok" style="font-size:10px"><i class="d"></i>已存庫</span>':'<button class="btn xs" onclick="saveToVault(\''+s.id+'\')">＋存入提示詞庫</button>';}
function charCard(c){var locks=[['face','臉'],['hair','髮'],['costume','服裝'],['accessory','配飾']];var h='<div class="char"><div class="ch-h"><div class="ava">'+c.emoji+'</div><div style="flex:1"><div class="cn">'+c.name+'</div><div class="mono" style="font-size:9.5px;color:var(--muted-2)">LoRA '+c.lora+' · '+c.refs+' 參考圖</div></div><span class="pill '+(c.grade==='precise'?'ok':'warn')+'">'+GRADE[c.grade]+'</span></div><div class="locks">';
 locks.forEach(function(l){h+='<span class="lock '+(c.locked?'on':'')+'">'+icon('lock')+l[1]+'</span>';});
 return h+'</div><div class="flex gap8 mt10">'+(c.grade!=='precise'?'<button class="btn xs gold" onclick="uploadRef(\''+c.id+'\')">上傳參考</button>':'')+'<button class="btn xs" onclick="changeChar(\''+c.id+'\')">改設定</button></div></div>';}

function vaultBrowser(){var v=S.vault||[];var head='<div style="padding:13px"><div class="flex gap8 mb8"><input class="input" style="height:36px" placeholder="搜尋 prompt、模型、標籤…"><span class="tag">我的詞庫</span></div><div class="tip">真實落點：promptLibrary.create · generate.recordGenResult → digital_asset_library</div></div>';
 if(!v.length) return head+'<div class="state" style="min-height:180px"><div class="ico">📚</div><div class="ti">還沒有存過提示詞</div><div class="ds">生成素材後按「＋ 存入提示詞庫」，即可在此再生成 / 插入 / 複製編輯。</div></div>';
 var h=head+'<div class="vault-grid">';
 v.forEach(function(e){h+='<div class="vcard"><div style="aspect-ratio:16/10;background:'+frameBg(e.params.seed,0)+'"></div><div style="padding:11px"><div class="line2" style="font-size:12.5px">'+e.prompt+'</div><div class="mt6 mono" style="font-size:9.5px;color:var(--muted-2)">'+e.params.model+' · seed '+e.params.seed+' · <span style="color:var(--clay-deep);text-transform:uppercase">'+e.params.provider+'</span> · ×'+e.uses+(e.status==='draft'?' · 草稿':'')+'</div><div class="flex gap6 mt10 wrapf"><button class="btn xs primary" onclick="reuseVault(\''+e.id+'\',\'regen\')">再生成</button><button class="btn xs" onclick="reuseVault(\''+e.id+'\',\'insert\')">插入素材</button><button class="btn xs ghost" onclick="reuseVault(\''+e.id+'\',\'fork\')">複製並編輯</button></div></div></div>';});
 return h+'</div>';}

function go(shell){S.shell=shell;S.projOpen=S.provOpen=false;render();}
function setProject(id){S.projectId=id;S.projOpen=false;S._msgs=null;if(S.rough)S.rough=null;toast('info','已載入專案上下文',S.projects[id].name+' · '+(S.projects[id].tokens/1000).toFixed(1)+'k tokens');render();}
function setProvider(id){S.provider=id;S.provOpen=false;toast('ok','GENERATION_PROVIDER','= '+id);render();}
function jumpStage(i){var p=P();var g=counts();var steps=activeSteps();var step=steps[i];if(step&&step.id==='asset'&&g.blocked>0){toast('warn','跳階補齊','有角色未定版 — 先在確認門補精準參考');S.tab='chars';}p.stage=i;render();}
function sendChat(){var box=document.getElementById('chatbox');if(!box||!box.value.trim())return;var txt=box.value.trim();S._msgs=(S._msgs||defaultMsgs()).concat([{role:'me',who:'你',text:txt}]);render();
 setTimeout(function(){var R={creative:'好——我用更有畫面感的方式拆解：先定調色溫與光，再排鏡。',calm:'我們慢慢來。先確認情緒基調，再決定每一鏡的呼吸節奏。',technical:'收到。我會逐鏡標 route(ref/text)、seed 與成本估算，並走確認門。'};S._msgs.push({role:'ai',who:'COMMANDER',text:R[S.persona]});render();},480);}
function uploadRef(id){var c=P().chars.find(function(x){return x.id===id;});if(!c)return;c.grade='precise';c.locked=true;c.refs+=3;if(c.lora==='未訓練')c.lora='排隊中';toast('ok','參考圖已上傳 · 角色升級',c.name+' → ✅ 精準，受影響鏡頭解鎖');render();}
function changeChar(id){var p=P();var c=p.chars.find(function(x){return x.id===id;});var n=0;p.shots.forEach(function(s){if(s.gen.status==='done'&&s.chars.indexOf(id)>=0){s.stale=true;n++;}});toast('warn',c.name+' 已改設定',n+' 個已生成鏡頭標記為過期待重生');render();}
function genShot(id,regen){var p=P();var s=p.shots.find(function(x){return x.id===id;});if(!s)return;var cost=PROVIDERS[S.provider].cost;
 if(S.credits<Math.round(cost*1000)&&S.provider!=='mock'){toast('bad','積分不足','需要 '+Math.round(cost*1000)+' pts · 前往 /learn 儲值');return;}
 toast('info','估算成本',s.no+' · '+PROVIDERS[S.provider].label+' · 約 $'+cost+'（先估再生成）');
 s.gen.status='generating';s.stale=false;render();
 setTimeout(function(){ if(S._faultProvider){s.gen.status='error';toast('bad','生成失敗',s.no+' · HTTP 504 · 可重試或切 provider');render();return;}
  s.gen.status='done';s.gen.provider=S.provider;if(regen)s.gen.variant=(s.gen.variant||0)+1;if(!regen)s.approved=false;
  S.credits-=Math.round(cost*1000);toast('ok','生成完成 · 已寫回資產庫',s.no+' · seed '+s.seed+' · -'+Math.round(cost*1000)+' 積分');render();},1500);}
function approveShot(id){var s=P().shots.find(function(x){return x.id===id;});s.approved=true;toast('ok','已核准關鍵影格',s.no+' · 可進 i2v');render();}
function scheduleReady(){var p=P();var ready=p.shots.filter(function(s){return gateOf(s,p.chars)==='ready'&&s.gen.status!=='done';});if(!ready.length){toast('warn','沒有可排程的鏡頭','就緒且未生成的鏡頭為 0');return;}
 toast('info','排程生成',ready.length+' 個就緒鏡頭已排入背景任務');var i=0;(function next(){if(i>=ready.length){toast('ok','批次生成完成',ready.length+' 鏡 · 已寫回專案');render();return;}var s=ready[i++];s.gen.status='generating';render();setTimeout(function(){s.gen.status='done';s.gen.provider=S.provider;s.approved=false;S.credits-=Math.round(PROVIDERS[S.provider].cost*1000);render();setTimeout(next,260);},700);})();}
function saveToVault(id){var p=P();var s=p.shots.find(function(x){return x.id===id;});if(!s)return;
 if((S.vault||[]).some(function(v){return v.fromShot===id;})){toast('warn','已存在 · 已更新使用次數','同 prompt+參數已在庫中');return;}
 toast('info','存入中…','promptLibrary.create');
 setTimeout(function(){S.vault.push({id:'v'+Date.now(),fromShot:id,prompt:s.title+'，療癒繪本風，暖色調，留白構圖',params:{model:'Z-Image-Turbo',seed:s.seed,size:'16:9',provider:s.gen.provider||S.provider},uses:1,status:S.autoDraft?'draft':'saved'});toast('ok','已存入提示詞庫 · 可重用',s.no+' · prompt + 參數 + 產出素材');render();},700);}
function reuseVault(id,mode){var e=S.vault.find(function(v){return v.id===id;});if(!e)return;if(mode==='regen'){e.uses++;toast('info','再生成','套用舊 prompt+參數 → 先估成本 → generate.*');}if(mode==='insert')toast('ok','已插入既有素材','不重生、不扣點');if(mode==='fork')toast('ok','已複製 prompt 可編輯','將另存為新 entry（forkedFrom）');render();}

function openCmdk(){S.cmdkOpen=true;renderCmdk();setTimeout(function(){var i=document.getElementById('cmdkInput');if(i)i.focus();},30);}
function closeCmdk(){S.cmdkOpen=false;document.getElementById('overlay').innerHTML='';}
function cmdkItems(){var list=[
 {g:'前往',ic:'🚪',t:'首頁',run:function(){go('home');}},{g:'前往',ic:'🎬',t:'影片製作',run:function(){go('video');}},{g:'前往',ic:'🖼',t:'社群圖文',run:function(){go('social');}},{g:'前往',ic:'📚',t:'學習文件',run:function(){go('learn');}},{g:'前往',ic:'⚙',t:'設定',run:function(){go('settings');}},
 {g:'代理動作',ic:'⚡',t:'排程生成所有就緒鏡',sub:'scheduleGeneration',run:function(){go('video');scheduleReady();}},
 {g:'代理動作',ic:'🧭',t:'重建 Context Packet',sub:'contextPacket.compileProject',run:function(){toast('ok','Context Packet 已重建','Deterministic→Cache→RAG');}},
 {g:'代理動作',ic:'🛠',t:'自訂工作流步驟',sub:'workflow editor',run:function(){go('video');openWF();}},
 {g:'代理動作',ic:'🌐',t:'研究 i2v 一致性',sub:'orbProxy.unifiedSearch',run:function(){go('learn');}}];
 Object.keys(S.projects).forEach(function(id){list.push({g:'切換專案（脊椎）',ic:S.projects[id].emoji,t:S.projects[id].name,run:function(){setProject(id);}});});
 Object.keys(PROVIDERS).forEach(function(id){list.push({g:'生成 Provider',ic:'⚙',t:'Provider = '+id.toUpperCase(),run:function(){setProvider(id);}});});
 return list;}
var cmdkSel=0,cmdkFilter='';
function cmdkFiltered(){return cmdkItems().filter(function(i){return (i.t+(i.sub||'')+i.g).toLowerCase().indexOf(cmdkFilter.toLowerCase())>=0;});}
function renderCmdk(){if(!S.cmdkOpen){document.getElementById('overlay').innerHTML='';return;}
 var items=cmdkFiltered();cmdkSel=Math.max(0,Math.min(cmdkSel,items.length-1));var html='',lastG='';
 if(!items.length) html='<div class="grp">查無指令</div><div class="it"><div class="ci">🔍</div><div class="ct">找不到「'+cmdkFilter+'」</div></div>';
 items.forEach(function(it,idx){if(it.g!==lastG){html+='<div class="grp">'+it.g+'</div>';lastG=it.g;}html+='<div class="it '+(idx===cmdkSel?'sel':'')+'" onclick="runCmdk('+idx+')" onmousemove="cmdkSel='+idx+';paintCmdk()"><div class="ci">'+it.ic+'</div><div><div class="ct">'+it.t+'</div>'+(it.sub?'<div class="cs">'+it.sub+'</div>':'')+'</div>'+(idx===cmdkSel?'<span class="kb">↵</span>':'')+'</div>';});
 var ov='<div class="cmdk-ov" onclick="if(event.target===this)closeCmdk()"><div class="cmdk"><div class="top"><span class="orbmini">'+orb(26)+'</span><input id="cmdkInput" placeholder="輸入指令、搜尋、或問光球…" oninput="cmdkInput(this.value)" onkeydown="cmdkKey(event)"><span class="kbd">esc</span></div><div class="list" id="cmdkList">'+html+'</div><div class="foot"><span>↑↓ 選擇</span><span>↵ 執行</span><span>esc 關閉</span><span>· 六代理層</span></div></div></div>';
 document.getElementById('overlay').innerHTML=ov;var inp=document.getElementById('cmdkInput');if(inp)inp.value=cmdkFilter;}
function cmdkInput(v){cmdkFilter=v;cmdkSel=0;renderCmdk();var e=document.getElementById('cmdkInput');if(e)e.focus();}
function paintCmdk(){var list=document.getElementById('cmdkList');if(!list)return;var els=list.querySelectorAll('.it');for(var i=0;i<els.length;i++)els[i].classList.toggle('sel',i===cmdkSel);}
function cmdkKey(e){var items=cmdkFiltered();
 if(e.key==='ArrowDown'){e.preventDefault();cmdkSel=Math.min(cmdkSel+1,items.length-1);paintCmdk();}
 else if(e.key==='ArrowUp'){e.preventDefault();cmdkSel=Math.max(cmdkSel-1,0);paintCmdk();}
 else if(e.key==='Enter'){e.preventDefault();runCmdk(cmdkSel);}
 else if(e.key==='Escape'){closeCmdk();}}
function runCmdk(idx){var it=cmdkFiltered()[idx];if(it){closeCmdk();it.run();}}

var SAMPLE='第一幕 · 克難坡的雨\n惹瓊巴在雨中攀上克難坡，遇見閉關多年的密勒日巴。\n第二幕 · 空景轉場\n雪山道的晨霧。\n第三幕 · 轉晴與攤位\n村莊集市，師徒對話傳法。';
function openGuided(){S.guided={step:'input',text:''};renderGuided();}
function closeGuided(){S.guided=null;document.getElementById('overlay').innerHTML='';}
function fillSample(){S.guided.text=SAMPLE;renderGuided();}
function renderGuided(){if(!S.guided){document.getElementById('overlay').innerHTML='';return;}var st=S.guided.step;var body='';
 if(st==='input') body='<div class="guided-body"><div class="eyebrow">STEP 1 · 貼上你的長腳本</div><div class="flex jc-b ai-c mt6"><p class="lead" style="margin:0">或從零開始，光球會引導你一步步把腳本做完。</p><button class="btn xs" onclick="fillSample()">填入範例腳本</button></div><textarea class="input" id="gtext" style="height:220px;margin-top:12px" placeholder="貼上長腳本…">'+(S.guided.text||'')+'</textarea></div><div class="actbar"><div style="flex:1"></div><button class="btn primary" onclick="runGuided()">自動拆解 →</button></div>';
 else if(st==='loading') body='<div class="guided-body"><div class="state"><div class="spin"></div><div class="ti">commander 正在拆解腳本<span class="dots"></span></div><div class="ds">Deterministic → Cache → RAG → 壓 Context Packet → 切幕/分鏡/抽角色場景</div></div></div>';
 else body=guidedReview();
 var ov='<div class="cmdk-ov" onclick="if(event.target===this)closeGuided()"><div class="cmdk" style="width:min(760px,94vw);max-height:84vh"><div class="top"><span class="orbmini">'+orb(26)+'</span><b style="flex:1;font-family:var(--f-serif)">引導式創作 · 長腳本拆片</b><span class="kbd" onclick="closeGuided()" style="cursor:pointer">esc</span></div>'+body+'</div></div>';
 document.getElementById('overlay').innerHTML=ov;}
function guidedReview(){var acts=[['第一幕 · 克難坡的雨',[['🔒','雨中攀坡','ref · 惹瓊巴 · 克難坡'],['🔒','師徒相見','ref · 密勒日巴+惹瓊巴 · 閉關洞']]],['第二幕 · 空景轉場',[['🌄','雪山晨霧','text · 雪山道']]],['第三幕 · 轉晴與攤位',[['🔒','集市傳法','ref · 惹瓊巴 · 村莊集市']]]];
 var h='<div class="guided-body"><div class="eyebrow">STEP 2 · 確認拆解結果（3 幕 · 4 鏡）</div><div class="flex gap6 wrapf mt10">';
 ['密勒日巴','惹瓊巴'].forEach(function(c){h+='<span class="pill">👤 '+c+'</span>';});
 ['雪山道','村莊集市'].forEach(function(s){h+='<span class="pill mute">🎬 '+s+'</span>';});
 h+='</div>';
 acts.forEach(function(a){h+='<div class="card pad" style="margin-top:12px"><div class="h-row"><span class="ti">'+a[0]+'</span><span class="cnt">'+a[1].length+' 鏡</span></div>';a[1].forEach(function(sh){h+='<div class="src"><div class="si">'+sh[0]+'</div><div style="flex:1"><div class="sn">'+sh[1]+'</div><div class="sm">'+sh[2]+'</div></div></div>';});h+='</div>';});
 h+='<div class="card pad" style="margin-top:12px;border-color:var(--gold-soft);background:var(--gold-tint)"><div class="flex gap8 ai-c"><span class="pill warn">確認門</span><span style="font-size:12.5px">抽出角色預設「⚠ 估算」，未定版不生成——可稍後在確認門上傳參考升級。</span></div></div>';
 h+='<input class="input" id="gname" placeholder="新專案名稱（留空＝寫入目前專案）" style="margin-top:12px"></div>';
 h+='<div class="actbar"><button class="btn ghost" onclick="S.guided.step=\'input\';renderGuided()">返回</button><div style="flex:1"></div><button class="btn" onclick="commitGuided(false)">寫入目前專案</button><button class="btn gold" onclick="commitGuided(true)">建立新專案再寫入</button></div>';
 return h;}
function runGuided(){var t=document.getElementById('gtext');S.guided.text=(t&&t.value)||SAMPLE;S.guided.step='loading';renderGuided();setTimeout(function(){S.guided.step='review';renderGuided();},1400);}
function commitGuided(newProj){var nm=document.getElementById('gname');var name=nm?nm.value:'';
 if(newProj){var id='p_new'+Date.now();S.projects[id]={emoji:'🎬',name:name||'引導式新專案',type:'影片',logline:'由長腳本拆解建立。',stage:2,tokens:1800,
   chars:[{id:'nc1',emoji:'🧙',name:'密勒日巴',grade:'precise',locked:true,lora:'已完成',refs:5},{id:'nc2',emoji:'🧘',name:'惹瓊巴',grade:'estimate',locked:false,lora:'未訓練',refs:0}],
   scenes:[{name:'雪山道',kind:'exterior',locked:false},{name:'村莊集市',kind:'named-place',locked:false}],
   shots:[{id:'ns1',no:'S01',title:'雨中攀坡',route:'ref',chars:['nc2'],seed:1101,approved:false,stale:false,gen:{status:'idle',variant:0}},{id:'ns2',no:'S02',title:'師徒相見',route:'ref',chars:['nc1','nc2'],seed:1201,approved:false,stale:false,gen:{status:'idle',variant:0}},{id:'ns3',no:'S03',title:'雪山晨霧',route:'text',chars:[],seed:1301,approved:false,stale:false,gen:{status:'idle',variant:0}},{id:'ns4',no:'S04',title:'集市傳法',route:'ref',chars:['nc2'],seed:1401,approved:false,stale:false,gen:{status:'idle',variant:0}}],
   notes:[],assets:[],sources:[{si:'☁',sn:'淡大腳本（匯入）',sm:'data_source',fresh:true}]};
   S.projectId=id;}
 else{var p=P();p.stage=Math.max(p.stage,2);p.shots.push({id:'gs'+Date.now(),no:'S0'+(p.shots.length+1),title:'雨中攀坡',route:'ref',chars:['c_rech'],seed:7777,approved:false,stale:false,gen:{status:'idle',variant:0}});}
 closeGuided();S.shell='video';S.view='auto';S.tab='shots';if(S.rough)S.rough=null;toast('ok','已寫入專案','腳本拆解 → 分鏡 · 角色 · Context Packet 已重建');render();}

/* 可設定工作流編輯器 */
function openWF(){S.wfOpen=true;renderWF();}
function closeWF(){S.wfOpen=false;document.getElementById('overlay').innerHTML='';}
function renderWF(){if(!S.wfOpen){document.getElementById('overlay').innerHTML='';return;}
 var rows='';
 S.workflow.forEach(function(s,i){rows+='<div class="wf-row"><span class="wf-grip">⋮⋮</span><span class="wf-name">'+s.name+'</span>'+(s.req?'<span class="pill mute" style="font-size:10px">必經</span>':'<span class="pill" style="font-size:10px">可選</span>')+'<div style="flex:1"></div><button class="btn xs" onclick="wfMove('+i+',-1)" '+(i===0?'disabled':'')+'>↑</button><button class="btn xs" onclick="wfMove('+i+',1)" '+(i===S.workflow.length-1?'disabled':'')+'>↓</button><button class="btn xs ghost" onclick="wfToggle('+i+')">'+(s.on?'啟用':'停用')+'</button><button class="btn xs danger" onclick="wfRemove('+i+')" '+(s.req?'disabled title="必經步驟不可刪"':'')+'>移除</button></div>';});
 var lib='';STEP_LIB.forEach(function(x){var has=S.workflow.some(function(w){return w.id===x.id;});lib+='<button class="btn xs" onclick="wfAdd(\''+x.id+'\')" '+(has?'disabled':'')+'>＋ '+x.name+'</button>';});
 var ov='<div class="cmdk-ov" onclick="if(event.target===this)closeWF()"><div class="cmdk" style="width:min(640px,94vw);max-height:84vh"><div class="top"><span class="orbmini">'+icon('wrench')+'</span><b style="flex:1;font-family:var(--f-serif)">工作流設定 · 步驟可新增／刪除／重排／啟用停用</b><span class="kbd" onclick="closeWF()" style="cursor:pointer">esc</span></div><div class="guided-body"><div class="eyebrow">目前步驟（拖拉重排；必經步驟不可刪）</div><div class="wf-list">'+rows+'</div><div class="eyebrow" style="margin-top:14px">從步驟庫加入</div><div class="flex gap6 wrapf mt6">'+lib+'</div><div class="tip" style="margin-top:12px">真實資料：工作流/步驟集屬資料模型，<b>待補（歸後端）</b>——建議表 user_workflows / workflow_steps（per 專案 / per 範本）；現以前端狀態示意。</div></div><div class="actbar"><button class="btn ghost" onclick="wfReset()">重設回預設範本</button><div style="flex:1"></div><button class="btn" onclick="toast(\'ok\',\'已存為自訂範本\',\'per 專案套用（user_workflows 待建）\');closeWF()">存成自訂範本</button><button class="btn primary" onclick="closeWF();render()">套用</button></div></div></div>';
 document.getElementById('overlay').innerHTML=ov;}
function wfMove(i,d){var j=i+d;if(j<0||j>=S.workflow.length)return;var a=S.workflow;var t=a[i];a[i]=a[j];a[j]=t;renderWF();render();}
function wfToggle(i){var s=S.workflow[i];if(s.req&&s.on){toast('warn','必經步驟','必經步驟不可停用');return;}s.on=!s.on;renderWF();render();}
function wfRemove(i){if(S.workflow[i].req){toast('warn','不可刪除','必經步驟不可刪除');return;}S.workflow.splice(i,1);renderWF();render();}
function wfAdd(id){if(S.workflow.some(function(w){return w.id===id;})){toast('warn','步驟已存在','此步驟已在工作流中');return;}var lib=STEP_LIB.find(function(x){return x.id===id;});S.workflow.push({id:lib.id,name:lib.name,req:false,on:true});toast('ok','已加入步驟',lib.name);renderWF();render();}
function wfReset(){S.workflow=DEFAULT_WF.map(function(x){return {id:x.id,name:x.name,req:x.req,on:x.on};});toast('info','已重設','回到 /video 預設工作流範本');renderWF();render();}

function orbAssistant(){var h='<div class="orb-fab-wrap">';
 if(S.bubble) h+='<div class="orb-bubble"><div class="ob-h"><b>'+S.bubble.emoji+' '+S.bubble.sp+'</b><span onclick="S.bubble=null;render()" style="cursor:pointer;color:var(--muted)">✕</span></div><div class="ob-t">'+S.bubble.text+'</div><div class="flex gap6 mt6"><button class="btn xs primary" onclick="openOrb(\'提示詞\')">'+S.bubble.cta+'</button><button class="btn xs ghost" onclick="S.bubble=null;render()">稍後</button></div></div>';
 if(S.orbOpen) h+=orbPanel();
 return h+'<button class="orb-fab" onclick="toggleOrb()" title="光球助手" aria-label="光球助手">'+orb(46)+'</button></div>';}
function openOrb(tab){S.orbOpen=true;S.orbTab=tab||S.orbTab||'本頁';S.bubble=null;render();}
function toggleOrb(){S.orbOpen=!S.orbOpen;if(S.orbOpen)S.bubble=null;render();}
function orbPanel(){var tabs=['本頁','提示詞','對話','專注流','積分','筆記'];var body='';
 if(S.orbTab==='提示詞') body='<div class="op-body">'+vaultBrowser()+'</div>';
 else if(S.orbTab==='本頁'){var tips={video:'導演 cockpit：對話→腳本→世界觀→分鏡→生成，一頁完成。光球可協助拆片、估成本、把提示詞存庫重用。',home:'選一個意圖開始，或貼長腳本一鍵拆片。'};
   var flow;if((S.vault||[]).length){flow='';S.vault.forEach(function(v){flow+='<div class="src"><div class="si">🔁</div><div style="flex:1;min-width:0"><div class="sn">'+v.prompt.slice(0,18)+'…</div><div class="sm">'+v.params.model+' · ×'+v.uses+'</div></div><button class="btn xs" onclick="reuseVault(\''+v.id+'\',\'regen\')">再跑</button></div>';}); }
   else flow='<div class="muted fz12" style="padding:6px 0">生成並存庫後，成功的「prompt→產出」工作流會出現在這裡，可一鍵重跑。</div>';
   body='<div class="op-body" style="padding:15px"><div class="eyebrow">本頁 · '+S.shell.toUpperCase()+'</div><p class="lead" style="font-size:12.5px;margin:6px 0 0">'+(tips[S.shell]||'此頁由平行工作階段設計中，共用同一脊椎與設計系統。')+'</p><div class="flow-wall"><div class="ctx-grp">'+icon('refresh')+' FLOW 展示牆 · 可重跑工作流</div>'+flow+'</div></div>';}
 else if(S.orbTab==='對話') body='<div class="op-body" style="padding:15px"><div class="muted fz12">與光球的跨頁對話（25 精靈小屋）。導演 AI 人格：<b>沉穩型</b> · 心情：專注。</div></div>';
 else if(S.orbTab==='專注流') body='<div class="op-body" style="padding:15px"><div class="muted fz12">專注流 FocusFlow：番茄鐘 / 療癒時間 / 聚焦時間（全站同步計時）。</div></div>';
 else if(S.orbTab==='積分') body='<div class="op-body" style="padding:15px"><div class="bigcount ok" style="max-width:170px"><b>'+S.credits.toLocaleString()+'</b><span>積分餘額</span></div><div class="muted fz12 mt10">先扣後生成（原子）· 失敗全額退還 · 1–500 pts · 不涉真實金錢。</div></div>';
 else body='<div class="op-body" style="padding:15px"><div class="muted fz12">本頁筆記（綁定專案 / 鏡號）。自動存筆記：開。</div></div>';
 var tabsH='';tabs.forEach(function(t){tabsH+='<button class="'+(S.orbTab===t?'on':'')+'" onclick="S.orbTab=\''+t+'\';render()">'+t+'</button>';});
 return '<div class="orb-panel"><div class="op-h"><span class="orbmini">'+orb(24)+'</span><div style="flex:1"><b style="font-family:var(--f-serif)">光球助手</b> <span class="tag">沉穩型</span></div><span onclick="S.orbOpen=false;render()" style="cursor:pointer;color:var(--muted)">✕</span></div><div class="op-tabs">'+tabsH+'</div>'+body+'</div>';}
function worldPanel(){var p=P();var cc=p.chars.filter(function(c){return c.grade==='precise';}).length,sc=p.scenes.filter(function(s){return s.locked;}).length;
 function row(label,n,m){return '<div class="mb12"><div class="flex jc-b" style="font-size:12px"><b>'+label+'</b><span class="mono" style="font-size:10px;color:var(--muted-2)">'+n+'/'+m+'</span></div><div class="meter mt6"><i style="width:'+(m?Math.round(n/m*100):0)+'%"></i></div></div>';}
 var cMax=Math.max(p.chars.length,5),sMax=Math.max(p.scenes.length,3),total=cc+sc+1,tMax=cMax+sMax+3;
 return '<div style="padding:16px"><div class="eyebrow mb8">世界觀 · 角色 / 場景 / 風格</div>'+row('角色',cc,cMax)+row('場景',sc,sMax)+row('風格',1,3)+'<div class="hr"></div>'+row('整體完成度',total,tMax)+'<div class="flex gap8 mt10"><button class="btn sm" onclick="toast(\'info\',\'空白新增\',\'新增角色／場景／風格欄位\')">空白新增</button><button class="btn sm gold" onclick="openGuided()">貼劇本 · AI 全自動</button></div></div>';}

function icon(n){var PA={command:'M9 3H5a2 2 0 00-2 2v4m0 6v4a2 2 0 002 2h4m6 0h4a2 2 0 002-2v-4m0-6V5a2 2 0 00-2-2h-4',layers:'M12 2l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5',chevron:'M6 9l6 6 6-6',check:'M20 6L9 17l-5-5',coin:'M12 2a10 10 0 100 20 10 10 0 000-20zM8 12h8',lock:'M6 10V8a6 6 0 1112 0v2M5 10h14v10H5z',brain:'M9 3a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 006 0V6a3 3 0 00-3-3z',send:'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',note:'M4 4h16v16H4zM8 9h8M8 13h6',db:'M12 3c5 0 8 1.5 8 3.5S17 10 12 10 4 8.5 4 6.5 7 3 12 3zM4 6.5v11C4 19.5 7 21 12 21s8-1.5 8-3.5v-11',gauge:'M12 14l4-4M3 18a9 9 0 1118 0',alert:'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',refresh:'M21 2v6h-6M3 12a9 9 0 0115-6.7L21 8M3 22v-6h6M21 12a9 9 0 01-15 6.7L3 16',wrench:'M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.6 2.6-2.4-2.4 2.6-2.6z'};
 return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(PA[n]||'')+'"/></svg>';}

document.addEventListener('keydown',function(e){if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(S.cmdkOpen)closeCmdk();else openCmdk();}});

render();
setTimeout(function(){ if(!S.bubbleShown){S.bubbleShown=true;S.bubble={sp:'守守',emoji:'🛡',text:'你這次的提示詞還沒存進提示詞庫，要存起來重用嗎？',cta:'去存入'};render();} },2800);
