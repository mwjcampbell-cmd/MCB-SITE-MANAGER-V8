/* MCB Site Manager - offline-first single-file storage (localStorage)
   Modules: Projects, Tasks, Diary, Variations, Subbies, Deliveries, Inspections, Reports, Settings
   Root logo: ./logo.png (used in header + reports)
*/
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

const STORE_KEY = "mcb_site_manager_v1_full";
const SETTINGS_KEY = "mcb_settings_v1";

const defaults = () => ({
  projects: [],
  tasks: [],
  diary: [],
  variations: [],
  subbies: [],
  deliveries: [],
  inspections: []
});

const defaultSettings = () => ({
  theme: "dark",
  companyName: "Matty Campbell Building",
  labourRate: 90, // NZD/hr default - editable
  currency: "NZD"
});

function loadState(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(!raw) return defaults();
    const parsed = JSON.parse(raw);
    return { ...defaults(), ...parsed };
  }catch(e){
    return defaults();
  }
}
function saveState(state){
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}
function loadSettings(){
  try{
    const raw = localStorage.getItem(SETTINGS_KEY);
    if(!raw) return defaultSettings();
    return { ...defaultSettings(), ...JSON.parse(raw) };
  }catch(e){
    return defaultSettings();
  }
}
function saveSettings(s){
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

let state = loadState();
let settings = loadSettings();

function applyTheme(){
  document.documentElement.setAttribute("data-theme", settings.theme || "dark");
}
applyTheme();

// Service worker
if("serviceWorker" in navigator){
  window.addEventListener("load", async ()=>{
    try{ await navigator.serviceWorker.register("./sw.js"); }catch(e){}
  });
}

function setHeader(title){
  $("#headerTitle").textContent = title || "MCB Site Manager";
}

function navTo(route, params={}){
  const q = new URLSearchParams(params).toString();
  location.hash = q ? `#/${route}?${q}` : `#/${route}`;
}

function parseRoute(){
  const h = location.hash || "#/projects";
  const [path, query] = h.replace(/^#\//,"").split("?");
  const params = Object.fromEntries(new URLSearchParams(query || ""));
  return { path: path || "projects", params };
}

function money(n){
  const v = Number(n || 0);
  return new Intl.NumberFormat("en-NZ", { style:"currency", currency:"NZD" }).format(v);
}
function dateFmt(iso){
  try{
    const d = new Date(iso);
    return d.toLocaleDateString("en-NZ", {year:"numeric", month:"short", day:"2-digit"});
  }catch(e){ return iso || "";}
}
function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function setBtnBusy(btn, busy, label="Saving…"){
  if(!btn) return;
  if(busy){
    btn.dataset._oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
  }else{
    btn.disabled = false;
    if(btn.dataset._oldText) btn.textContent = btn.dataset._oldText;
    delete btn.dataset._oldText;
  }
}
function showSavingHint(msg="Working…"){
  const el = document.createElement("div");
  el.className = "savingHint";
  el.textContent = msg;
  const modal = document.querySelector("#modal");
  if(modal) modal.appendChild(el);
  return el;
}
function confirmDelete(label){
  return confirm(`Delete ${label}? This can't be undone.`);
}

function isoToday(){
  return new Date().toISOString().slice(0,10);
}
function inNextDays(dateStr, days){
  if(!dateStr) return false;
  const d0 = new Date(isoToday());
  const d1 = new Date(dateStr);
  const diff = (d1 - d0) / 86400000;
  return diff >= 0 && diff <= days;
}
function upcomingSummary(days=7, limit=12){
  const items = [];
  // Due tasks
  for(const t of (state.tasks||[])){
    if(t.dueDate && inNextDays(t.dueDate, days) && t.status !== "Done"){
      const p = projectById(t.projectId);
      items.push({ when: t.dueDate, kind:"Task", title:t.title, project:p?.name || "", badge:t.status||"To do", nav: {route:"project", params:{id:t.projectId, tab:"tasks"}} });
    }
  }
  // Deliveries
  for(const d of (state.deliveries||[])){
    if(d.date && inNextDays(d.date, days)){
      const p = projectById(d.projectId);
      items.push({ when: d.date, kind:"Delivery", title:(d.supplier||"Delivery"), project:p?.name || "", badge:d.status||"Expected", nav: {route:"project", params:{id:d.projectId, tab:"deliveries"}} });
    }
  }
  // Inspections
  for(const i of (state.inspections||[])){
    if(i.date && inNextDays(i.date, days)){
      const p = projectById(i.projectId);
      items.push({ when: i.date, kind:"Inspection", title:(i.type||"Inspection"), project:p?.name || "", badge:i.result||"Booked", nav: {route:"project", params:{id:i.projectId, tab:"inspections"}} });
    }
  }

  items.sort((a,b)=> (a.when||"").localeCompare(b.when||"") || a.kind.localeCompare(b.kind));
  return items.slice(0, limit);
}
function upcomingCardHTML(days=7){
  const items = upcomingSummary(days);
  if(!items.length){
    return `
      <div class="card">
        <h2>Upcoming (next ${days} days)</h2>
        <div class="sub">Nothing scheduled. You're having a good week.</div>
      </div>
    `;
  }
  const rows = items.map(it=>`
    <div class="item clickable" data-upnav="${encodeURIComponent(JSON.stringify(it.nav))}">
      <div class="row space">
        <div>
          <div class="title">${escapeHtml(dateFmt(it.when))} — ${escapeHtml(it.kind)}</div>
          <div class="meta">${escapeHtml(it.title)}${it.project ? ` • ${escapeHtml(it.project)}` : ""}</div>
        </div>
        <div class="meta"><span class="badge">${escapeHtml(it.badge||"")}</span></div>
      </div>
    </div>
  `).join("");
  return `
    <div class="card">
      <div class="row space">
        <h2>Upcoming (next ${days} days)</h2>
        <button class="btn small" id="upcomingRefresh" type="button">Refresh</button>
      </div>
      <div class="list" id="upcomingList">${rows}</div>
    </div>
  `;
}

// Modal
function showModal(html){
  $("#modal").innerHTML = html;
  $("#modalBack").classList.add("show");
}
function closeModal(){
  $("#modalBack").classList.remove("show");
  $("#modal").innerHTML = "";
}
$("#modalBack").addEventListener("click", (e)=>{
  if(e.target.id === "modalBack") closeModal();
});

// File -> dataURL for offline
function filesToDataUrls(fileList){
  const files = [...(fileList || [])];
  if(!files.length) return Promise.resolve([]);

  return Promise.all(files.map(file => new Promise(resolve => {
    try{
      const reader = new FileReader();
      reader.onload = () => resolve({
        id: uid(),
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: reader.result,
        createdAt: new Date().toISOString()
      });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    }catch(e){
      resolve(null);
    }
  }))).then(arr => arr.filter(Boolean));
}

// Geo (optional): try geocode with Nominatim (works on https; may be blocked on some hosts)
async function geocodeAddress(address){
  const q = encodeURIComponent(address);
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1&countrycodes=nz`;
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if(!res.ok) throw new Error("geocode failed");
  const data = await res.json();
  if(!data || !data[0]) throw new Error("no result");
  return { lat: Number(data[0].lat), lng: Number(data[0].lon), display: data[0].display_name };
}

// Helpers
function projectById(id){ return state.projects.find(p=>p.id===id); }
function subbieById(id){ return state.subbies.find(s=>s.id===id); }

function render(){
  const { path, params } = parseRoute();
  const app = $("#app");
  // active nav styling
  $$(".nav .btn").forEach(b=>{
    b.classList.toggle("primary", b.dataset.nav === path);
  });

  if(path === "projects") return renderProjects(app, params);
  if(path === "project") return renderProjectDetail(app, params);
  if(path === "tasks") return renderTasks(app, params);
  if(path === "diary") return renderDiary(app, params);
  if(path === "reports") return renderReports(app, params);
  if(path === "settings") return renderSettings(app, params);
  // fallback
  navTo("projects");
}

window.addEventListener("hashchange", render);
window.addEventListener("load", ()=>{
  if(!location.hash) navTo("projects");
  render();
});

// Footer nav
$$(".nav .btn").forEach(b=>b.addEventListener("click", ()=>navTo(b.dataset.nav)));

// Header buttons
$("#homeBtn").addEventListener("click", ()=>navTo("projects"));
$("#themeBtn").addEventListener("click", ()=>{
  settings.theme = settings.theme === "dark" ? "light" : "dark";
  saveSettings(settings);
  applyTheme();
});
$("#exportBtn").addEventListener("click", ()=>{
  const blob = new Blob([JSON.stringify({ state, settings, exportedAt: new Date().toISOString() }, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mcb-site-manager-export-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
});
$("#importBtn").addEventListener("click", ()=>$("#importFile").click());
$("#importFile").addEventListener("change", async (e)=>{
  const file = e.target.files?.[0];
  if(!file) return;
  try{
    const text = await file.text();
    const data = JSON.parse(text);

    // Accept multiple export formats:
    // 1) { state, settings, exportedAt }
    // 2) { projects, tasks, diary, ... }   (older/raw state)
    // 3) { mcb: {state...} } or nested variants (best-effort)
    let nextState = null;
    let nextSettings = null;

    if(data && typeof data === "object"){
      if(data.state) nextState = data.state;
      if(data.settings) nextSettings = data.settings;

      // Raw state fallback
      const looksLikeState = ("projects" in data) || ("tasks" in data) || ("diary" in data) || ("variations" in data) || ("subbies" in data);
      if(!nextState && looksLikeState) nextState = data;

      // Nested fallback (rare)
      if(!nextState && data.mcb && typeof data.mcb === "object"){
        if(data.mcb.state) nextState = data.mcb.state;
        if(data.mcb.settings) nextSettings = data.mcb.settings;
      }
    }

    if(!nextState && !nextSettings){
      alert("Import failed: unrecognised file format.");
      return;
    }

    if(nextState) state = { ...defaults(), ...nextState };
    if(nextSettings) settings = { ...defaultSettings(), ...nextSettings };

    await saveState(state);
    await saveSettings(settings);
    applyTheme();
    render();
    alert("Imported successfully.");
  }catch(err){
    console.error(err);
    alert("Import failed. Check the file.");
  }finally{
    e.target.value = "";
  }
});

// ----------------- Projects -----------------
function renderProjects(app){
  setHeader("Projects");
  const list = state.projects
    .slice()
    .sort((a,b)=> (b.updatedAt||"").localeCompare(a.updatedAt||""));
  app.innerHTML = `
    <div class="grid two">
      ${upcomingCardHTML(7)}
      <div class="card">
        <div class="row space">
          <h2>Projects</h2>
          <button class="btn primary" id="newProject" type="button">New Project</button>
        </div>
        <div class="sub">Tap a project to manage: diary, tasks, variations, subbies, deliveries, inspections, reports.</div>
        <hr/>
        <div class="list" id="projectList">
          ${list.length ? list.map(p=>projectCard(p)).join("") : `<div class="sub">No projects yet. Create your first one.</div>`}
        </div>
      </div>
      <div class="card">
        <h2>Quick tips</h2>
        <div class="sub">
          • “Drive” opens Waze with the project destination.<br/>
          • “Live Map” shows the site location based on the saved address (and coordinates if geocoded).<br/>
          • Everything is editable / deletable. Data is stored locally on this device.<br/>
        </div>
        <hr/>
        <button class="btn" id="demoBtn" type="button">Load demo data</button>
        <div class="smallmuted">Demo is optional — you can delete it later.</div>
      </div>
    </div>
  `;
  $("#newProject").onclick = ()=> openProjectForm();
  $("#demoBtn").onclick = ()=> loadDemo();
  $$("#projectList .item").forEach(el=>{
    el.addEventListener("click", (e)=>{
      if(e.target.closest("[data-action]")) return;
      const id = el.dataset.id;
      navTo("project", { id });
    });
  });
  $$("#projectList [data-action='drive']").forEach(btn=>btn.addEventListener("click",(e)=>{
    e.stopPropagation();
    const id = btn.dataset.id;
    openWazeForProject(projectById(id));
  }));
  $$("#projectList [data-action='edit']").forEach(btn=>btn.addEventListener("click",(e)=>{
    e.stopPropagation();
    openProjectForm(projectById(btn.dataset.id));
  }));
  $$("#projectList [data-action='delete']").forEach(btn=>btn.addEventListener("click",(e)=>{
    e.stopPropagation();
    const id = btn.dataset.id;
    const p = projectById(id);
    if(!p) return;
    if(confirmDelete(`project "${p.name}"`)){
      // also remove linked items
      state.projects = state.projects.filter(x=>x.id!==id);
      state.tasks = state.tasks.filter(t=>t.projectId!==id);
      state.diary = state.diary.filter(d=>d.projectId!==id);
      state.variations = state.variations.filter(v=>v.projectId!==id);
      state.deliveries = state.deliveries.filter(d=>d.projectId!==id);
      state.inspections = state.inspections.filter(i=>i.projectId!==id);
      // keep subbies global
      saveState(state);
      render();
    }
  }));
  // Upcoming card navigation
  $$("#app [data-upnav]").forEach(el=>{
    el.addEventListener("click", ()=>{
      try{
        const nav = JSON.parse(decodeURIComponent(el.dataset.upnav));
        if(nav?.route) navTo(nav.route, nav.params || {});
      }catch(e){}
    });
  });
  $("#upcomingRefresh") && ($("#upcomingRefresh").onclick = ()=> render());

}

function projectCard(p){
  const addr = p.address ? escapeHtml(p.address) : "No address";
  const coords = (p.lat && p.lng) ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : "—";
  return `
    <div class="item" data-id="${p.id}">
      <div class="row space">
        <div>
          <div class="title">${escapeHtml(p.name || "Untitled project")}</div>
          <div class="meta">${addr}</div>
          <div class="meta">Coords: ${coords}</div>
        </div>
        <div class="row">
          <button class="btn small" data-action="drive" data-id="${p.id}" type="button">Drive</button>
          <button class="btn small" data-action="edit" data-id="${p.id}" type="button">Edit</button>
          <button class="btn small danger" data-action="delete" data-id="${p.id}" type="button">Delete</button>
        </div>
      </div>
    </div>
  `;
}

function openProjectForm(p=null){
  const isEdit = !!p;
  const data = p || { id: uid(), name:"", address:"", clientName:"", clientPhone:"", notes:"", lat:null, lng:null };
  showModal(`
    <div class="row space">
      <h2>${isEdit ? "Edit Project" : "New Project"}</h2>
      <button class="btn" id="closeM" type="button">Close</button>
    </div>
    <label>Project name</label>
    <input class="input" id="p_name" value="${escapeHtml(data.name)}" placeholder="e.g., 14 Kowhai Road Renovation" />
    <label>Address</label>
    <input class="input" id="p_address" value="${escapeHtml(data.address)}" placeholder="Street, suburb, city (NZ)" />
    <div class="row" style="margin-top:10px">
      <button class="btn" id="geoBtn" type="button">Geocode address</button>
      <span class="smallmuted" id="geoStatus">${(data.lat && data.lng) ? `Saved coords: ${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}` : "Optional (improves map + Waze accuracy)"}</span>
    </div>
    <div class="grid two">
      <div>
        <label>Client name</label>
        <input class="input" id="p_clientName" value="${escapeHtml(data.clientName||"")}" placeholder="Optional" />
      </div>
      <div>
        <label>Client phone</label>
        <input class="input" id="p_clientPhone" value="${escapeHtml(data.clientPhone||"")}" placeholder="Optional" />
      </div>
    </div>
    <label>Notes</label>
    <textarea class="input" id="p_notes" placeholder="Access, hazards, gate code, etc.">${escapeHtml(data.notes||"")}</textarea>
    <hr/>
    <div class="row space actionsSticky">
      <button class="btn ${isEdit ? "primary" : "primary"}" id="saveP" type="button">${isEdit ? "Save changes" : "Create project"}</button>
      ${isEdit ? `<button class="btn danger" id="delP" type="button">Delete</button>` : `<button class="btn" id="cancelP" type="button">Cancel</button>`}
    </div>
  `);
  $("#closeM").onclick = closeModal;
  $("#cancelP") && ($("#cancelP").onclick = closeModal);

  $("#geoBtn").onclick = async ()=>{
    const addr = $("#p_address").value.trim();
    if(!addr) alert("Enter an address first.");
    $("#geoStatus").textContent = "Geocoding…";
    try{
      const g = await geocodeAddress(addr);
      data.lat = g.lat; data.lng = g.lng;
      $("#geoStatus").textContent = `Saved coords: ${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}`;
    }catch(e){
      $("#geoStatus").textContent = "Geocode failed (try again later or just save address).";
    }
  };

  $("#saveP").onclick = ()=>{
    data.name = $("#p_name").value.trim();
    data.address = $("#p_address").value.trim();
    data.clientName = $("#p_clientName").value.trim();
    data.clientPhone = $("#p_clientPhone").value.trim();
    data.notes = $("#p_notes").value.trim();
    data.updatedAt = new Date().toISOString();
    if(!data.name) alert("Project name required.");
    if(isEdit){
      state.projects = state.projects.map(x=>x.id===data.id ? data : x);
    }else{
      data.createdAt = new Date().toISOString();
      state.projects.unshift(data);
    }
    saveState(state);
    closeModal();
    render();
  };

  $("#delP") && ($("#delP").onclick = ()=>{
    if(confirmDelete(`project "${data.name}"`)){
      state.projects = state.projects.filter(x=>x.id!==data.id);
      state.tasks = state.tasks.filter(t=>t.projectId!==data.id);
      state.diary = state.diary.filter(d=>d.projectId!==data.id);
      state.variations = state.variations.filter(v=>v.projectId!==data.id);
      state.deliveries = state.deliveries.filter(d=>d.projectId!==data.id);
      state.inspections = state.inspections.filter(i=>i.projectId!==data.id);
      saveState(state);
      closeModal();
      render();
    }
  });
}

function openWazeForProject(p){
  if(!p) return;
  const hasCoords = p.lat && p.lng;
  const url = hasCoords
    ? `https://waze.com/ul?ll=${encodeURIComponent(p.lat + "," + p.lng)}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(p.address || p.name)}&navigate=yes`;
  window.open(url, "_blank");
}

// ----------------- Project Detail (tabs) -----------------
function renderProjectDetail(app, params){
  const p = projectById(params.id);
  if(!p){ navTo("projects"); return; }
  setHeader(p.name || "Project");

  const tab = params.tab || "overview";
  const tabs = [
    ["overview","Overview"],
    ["map","Live Map"],
    ["tasks","Tasks"],
    ["diary","Diary"],
    ["variations","Variations"],
    ["subbies","Subbies"],
    ["deliveries","Deliveries"],
    ["inspections","Inspections"],
    ["reports","Reports"]
  ];
  app.innerHTML = `
    <div class="card">
      <div class="row space">
        <div>
          <h2>${escapeHtml(p.name)}</h2>
          <div class="sub">${escapeHtml(p.address || "")}</div>
        </div>
        <div class="row noPrint">
          <button class="btn" id="driveBtn" type="button">Drive (Waze)</button>
          <button class="btn" id="editProjBtn" type="button">Edit</button>
        </div>
      </div>
      <div class="tabs noPrint">
        ${tabs.map(([k,label])=>`<button class="btn small tab ${k===tab?"primary":""}" data-tab="${k}" type="button">${label}</button>`).join("")}
      </div>
    </div>

    <div id="tabContent" style="margin-top:12px"></div>
  `;
  $("#driveBtn").onclick = ()=> openWazeForProject(p);
  $("#editProjBtn").onclick = ()=> openProjectForm(p);
  $$(".tab").forEach(b=>b.onclick = ()=> navTo("project", { id:p.id, tab:b.dataset.tab }));

  const wrap = $("#tabContent");
  if(tab==="overview") wrap.innerHTML = projectOverview(p);
  if(tab==="map") wrap.innerHTML = projectMap(p);
  if(tab==="tasks") wrap.innerHTML = projectTasks(p);
  if(tab==="diary") wrap.innerHTML = projectDiary(p);
  if(tab==="variations") wrap.innerHTML = projectVariations(p);
  if(tab==="subbies") wrap.innerHTML = projectSubbies(p);
  if(tab==="deliveries") wrap.innerHTML = projectDeliveries(p);
  if(tab==="inspections") wrap.innerHTML = projectInspections(p);
  if(tab==="reports") wrap.innerHTML = projectReports(p);

  bindProjectTabEvents(p, tab);
}

function projectOverview(p){
  const openTasks = state.tasks.filter(t=>t.projectId===p.id && t.status!=="Done").length;
  const diaryCount = state.diary.filter(d=>d.projectId===p.id).length;
  const varOpen = state.variations.filter(v=>v.projectId===p.id && v.status!=="Approved").length;
  const inspNext = state.inspections
    .filter(i=>i.projectId===p.id)
    .sort((a,b)=>(a.date||"").localeCompare(b.date||""))
    .find(i=> new Date(i.date) >= new Date(new Date().toISOString().slice(0,10)));
  return `
    <div class="grid two">
      <div class="card">
        <h2>Status</h2>
        <div class="kv"><div class="k">Open tasks</div><div class="v">${openTasks}</div></div>
        <div class="kv"><div class="k">Diary entries</div><div class="v">${diaryCount}</div></div>
        <div class="kv"><div class="k">Open variations</div><div class="v">${varOpen}</div></div>
        <div class="kv"><div class="k">Next inspection</div><div class="v">${inspNext ? `${escapeHtml(inspNext.type)} — ${dateFmt(inspNext.date)}` : "—"}</div></div>
        <hr/>
        <button class="btn primary" id="quickTask" type="button">New task</button>
        <button class="btn" id="quickDiary" type="button">New diary entry</button>
        <button class="btn" id="quickVar" type="button">New variation</button>
      </div>

      <div class="card">
        <h2>Contacts</h2>
        <div class="kv"><div class="k">Client</div><div class="v">${escapeHtml(p.clientName||"—")}</div></div>
        <div class="kv"><div class="k">Phone</div><div class="v">${p.clientPhone ? `<a href="tel:${escapeHtml(p.clientPhone)}">${escapeHtml(p.clientPhone)}</a>` : "—"}</div></div>
        <hr/>
        <h2>Notes</h2>
        <div class="sub">${escapeHtml(p.notes||"—")}</div>
      </div>
    </div>
  `;
}

function projectMap(p){
  const addr = p.address || "";
  const hasCoords = p.lat && p.lng;
  const mapSrc = hasCoords
    ? `https://www.openstreetmap.org/export/embed.html?marker=${encodeURIComponent(p.lat)}%2C${encodeURIComponent(p.lng)}&zoom=16`
    : `https://www.openstreetmap.org/export/embed.html?search=${encodeURIComponent(addr)}&zoom=16`;
  // Note: OSM embed doesn't always support search param everywhere; fallback is showing map homepage with query in link.
  const link = hasCoords
    ? `https://www.openstreetmap.org/?mlat=${encodeURIComponent(p.lat)}&mlon=${encodeURIComponent(p.lng)}#map=16/${encodeURIComponent(p.lat)}/${encodeURIComponent(p.lng)}`
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(addr)}`;
  return `
    <div class="card">
      <div class="row space">
        <h2>Live Map</h2>
        <div class="row noPrint">
          <button class="btn" id="copyAddr" type="button">Copy address</button>
          <a class="btn" href="${link}" target="_blank" rel="noopener">Open map</a>
        </div>
      </div>
      <div class="sub">${escapeHtml(addr || "No address saved.")}</div>
      <div style="margin-top:12px; border-radius:16px; overflow:hidden; border:1px solid var(--border)">
        <iframe title="map" src="${mapSrc}" style="width:100%; height:420px; border:0"></iframe>
      </div>
      <div class="smallmuted" style="margin-top:10px">
        Tip: Use “Geocode address” in Edit Project for best accuracy.
      </div>
    </div>
  `;
}

function bindProjectTabEvents(p, tab){
  if(tab==="overview"){
    $("#quickTask").onclick = ()=> openTaskForm({ projectId:p.id });
    $("#quickDiary").onclick = ()=> openDiaryForm({ projectId:p.id });
    $("#quickVar").onclick = ()=> openVariationForm({ projectId:p.id });
  }
  if(tab==="map"){
    $("#copyAddr") && ($("#copyAddr").onclick = async ()=>{
      try{ await navigator.clipboard.writeText(p.address || ""); alert("Copied."); }catch(e){ alert("Copy failed."); }
    });
  }
  if(tab==="tasks"){
    $("#addTaskProj").onclick = ()=> openTaskForm({ projectId:p.id });
    $$("#taskListProj [data-action='edit']").forEach(b=>b.onclick = ()=> openTaskForm(state.tasks.find(t=>t.id===b.dataset.id)));
    $$("#taskListProj [data-action='delete']").forEach(b=>b.onclick = ()=>{
      const t = state.tasks.find(x=>x.id===b.dataset.id);
      if(t && confirmDelete(`task "${t.title}"`)){
        state.tasks = state.tasks.filter(x=>x.id!==t.id);
        saveState(state); render();
      }
    });
  }
  if(tab==="diary"){
    $("#addDiaryProj").onclick = ()=> openDiaryForm({ projectId:p.id });
    $$("#diaryListProj [data-action='edit']").forEach(b=>b.onclick = ()=> openDiaryForm(state.diary.find(d=>d.id===b.dataset.id)));
    $$("#diaryListProj [data-action='delete']").forEach(b=>b.onclick = ()=>{
      const d = state.diary.find(x=>x.id===b.dataset.id);
      if(d && confirmDelete(`diary entry ${dateFmt(d.date)}`)){
        state.diary = state.diary.filter(x=>x.id!==d.id);
        saveState(state); render();
      }
    });
  }
  if(tab==="variations"){
    $("#addVarProj").onclick = ()=> openVariationForm({ projectId:p.id });
    $$("#varListProj [data-action='edit']").forEach(b=>b.onclick = ()=> openVariationForm(state.variations.find(v=>v.id===b.dataset.id)));
    $$("#varListProj [data-action='delete']").forEach(b=>b.onclick = ()=>{
      const v = state.variations.find(x=>x.id===b.dataset.id);
      if(v && confirmDelete(`variation "${v.title}"`)){
        state.variations = state.variations.filter(x=>x.id!==v.id);
        saveState(state); render();
      }
    });
  }
  if(tab==="subbies"){
    $("#addSubbie").onclick = ()=> openSubbieForm();
    $$("#subbieListProj [data-action='edit']").forEach(b=>b.onclick = ()=> openSubbieForm(subbieById(b.dataset.id)));
    $$("#subbieListProj [data-action='delete']").forEach(b=>b.onclick = ()=>{
      const s = subbieById(b.dataset.id);
      if(s && confirmDelete(`subbie "${s.name}"`)){
        state.subbies = state.subbies.filter(x=>x.id!==s.id);
        // unassign from tasks
        state.tasks = state.tasks.map(t=> t.assignedSubbieId===s.id ? {...t, assignedSubbieId:null} : t);
        saveState(state); render();
      }
    });
  }
  if(tab==="deliveries"){
    $("#addDelivery").onclick = ()=> openDeliveryForm({ projectId:p.id });
    $$("#deliveryListProj [data-action='edit']").forEach(b=>b.onclick = ()=> openDeliveryForm(state.deliveries.find(d=>d.id===b.dataset.id)));
    $$("#deliveryListProj [data-action='delete']").forEach(b=>b.onclick = ()=>{
      const d = state.deliveries.find(x=>x.id===b.dataset.id);
      if(d && confirmDelete(`delivery "${d.supplier || 'delivery'}"`)){
        state.deliveries = state.deliveries.filter(x=>x.id!==d.id);
        saveState(state); render();
      }
    });
  }
  if(tab==="inspections"){
    $("#addInspection").onclick = ()=> openInspectionForm({ projectId:p.id });
    $$("#inspectionListProj [data-action='edit']").forEach(b=>b.onclick = ()=> openInspectionForm(state.inspections.find(i=>i.id===b.dataset.id)));
    $$("#inspectionListProj [data-action='delete']").forEach(b=>b.onclick = ()=>{
      const i = state.inspections.find(x=>x.id===b.dataset.id);
      if(i && confirmDelete(`inspection "${i.type}"`)){
        state.inspections = state.inspections.filter(x=>x.id!==i.id);
        saveState(state); render();
      }
    });
  }
  if(tab==="reports"){
    $("#runProjectReport").onclick = ()=> runReportUI(p.id);
    $("#hnryExportProj").onclick = ()=> runHnryExportUI(p.id);
  }
}

// Project tab renderers
function projectTasks(p){
  const tasks = state.tasks
    .filter(t=>t.projectId===p.id)
    .sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
  return `
    <div class="card">
      <div class="row space">
        <h2>Tasks</h2>
        <button class="btn primary" id="addTaskProj" type="button">New task</button>
      </div>
      <div class="list" id="taskListProj">
        ${tasks.length ? tasks.map(taskRow).join("") : `<div class="sub">No tasks yet.</div>`}
      </div>
    </div>
  `;
}

function taskRow(t){
  const badgeClass = t.status==="Done" ? "ok" : (t.status==="In progress" ? "warn" : "");
  const subbie = t.assignedSubbieId ? subbieById(t.assignedSubbieId) : null;
  return `
    <div class="item">
      <div class="row space">
        <div>
          <div class="title">${escapeHtml(t.title)}</div>
          <div class="meta">
            <span class="badge ${badgeClass}">${escapeHtml(t.status||"To do")}</span>
            ${subbie ? `<span class="badge">👷 ${escapeHtml(subbie.name)}</span>` : ""}
            ${t.dueDate ? `<span class="badge">📅 ${dateFmt(t.dueDate)}</span>` : ""}
          </div>
        </div>
        <div class="row">
          <button class="btn small" data-action="edit" data-id="${t.id}" type="button">Edit</button>
          <button class="btn small danger" data-action="delete" data-id="${t.id}" type="button">Delete</button>
        </div>
      </div>
      ${t.photos?.length ? `<div class="thumbgrid">${t.photos.slice(0,6).map(ph=>`<div class="thumb"><img src="${ph.dataUrl}" alt="${escapeHtml(ph.name)}"/></div>`).join("")}</div>` : ""}
    </div>
  `;
}

function projectDiary(p){
  const entries = state.diary
    .filter(d=>d.projectId===p.id)
    .sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  return `
    <div class="card">
      <div class="row space">
        <h2>Diary</h2>
        <button class="btn primary" id="addDiaryProj" type="button">New entry</button>
      </div>
      <div class="list" id="diaryListProj">
        ${entries.length ? entries.map(diaryRow).join("") : `<div class="sub">No diary entries yet.</div>`}
      </div>
    </div>
  `;
}
function diaryRow(d){
  return `
    <div class="item">
      <div class="row space">
        <div>
          <div class="title">${dateFmt(d.date)}</div>
          <div class="meta">${escapeHtml((d.summary||"").slice(0,140))}</div>
          <div class="meta">
            ${d.hours ? `<span class="badge">⏱ ${escapeHtml(String(d.hours))}h</span>` : ""}
            ${d.billable ? `<span class="badge ok">Billable</span>` : `<span class="badge">Non‑billable</span>`}
            ${d.category ? `<span class="badge">${escapeHtml(d.category)}</span>` : ""}
          </div>
        </div>
        <div class="row">
          <button class="btn small" data-action="edit" data-id="${d.id}" type="button">Edit</button>
          <button class="btn small danger" data-action="delete" data-id="${d.id}" type="button">Delete</button>
        </div>
      </div>
      ${d.photos?.length ? `<div class="thumbgrid">${d.photos.slice(0,6).map(ph=>`<div class="thumb"><img src="${ph.dataUrl}" alt="${escapeHtml(ph.name)}"/></div>`).join("")}</div>` : ""}
    </div>
  `;
}

function projectVariations(p){
  const vars = state.variations
    .filter(v=>v.projectId===p.id)
    .sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
  return `
    <div class="card">
      <div class="row space">
        <h2>Variations</h2>
        <button class="btn primary" id="addVarProj" type="button">New variation</button>
      </div>
      <div class="list" id="varListProj">
        ${vars.length ? vars.map(variationRow).join("") : `<div class="sub">No variations yet.</div>`}
      </div>
    </div>
  `;
}
function variationRow(v){
  const badgeClass = v.status==="Approved" ? "ok" : (v.status==="Sent" ? "warn" : "");
  return `
    <div class="item">
      <div class="row space">
        <div>
          <div class="title">${escapeHtml(v.title)}</div>
          <div class="meta">
            <span class="badge ${badgeClass}">${escapeHtml(v.status||"Draft")}</span>
            ${v.amount ? `<span class="badge">💲 ${money(v.amount)}</span>` : ""}
            ${v.date ? `<span class="badge">📅 ${dateFmt(v.date)}</span>` : ""}
          </div>
          <div class="meta">${escapeHtml((v.description||"").slice(0,160))}</div>
        </div>
        <div class="row">
          <button class="btn small" data-action="edit" data-id="${v.id}" type="button">Edit</button>
          <button class="btn small danger" data-action="delete" data-id="${v.id}" type="button">Delete</button>
        </div>
      </div>
      ${v.photos?.length ? `<div class="thumbgrid">${v.photos.slice(0,6).map(ph=>`<div class="thumb"><img src="${ph.dataUrl}" alt="${escapeHtml(ph.name)}"/></div>`).join("")}</div>` : ""}
    </div>
  `;
}

function projectSubbies(p){
  // subbies are global; show with quick assign by using tasks, etc.
  const subbies = state.subbies.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  const used = new Set(state.tasks.filter(t=>t.projectId===p.id).map(t=>t.assignedSubbieId).filter(Boolean));
  return `
    <div class="card">
      <div class="row space">
        <h2>Subbies</h2>
        <button class="btn primary" id="addSubbie" type="button">Add subbie</button>
      </div>
      <div class="sub">Subbies are shared across projects. Assign them to tasks.</div>
      <hr/>
      <div class="list" id="subbieListProj">
        ${subbies.length ? subbies.map(s=>subbieRow(s, used.has(s.id))).join("") : `<div class="sub">No subcontractors saved yet.</div>`}
      </div>
    </div>
  `;
}
function subbieRow(s, used){
  return `
    <div class="item">
      <div class="row space">
        <div>
          <div class="title">${escapeHtml(s.name)}</div>
          <div class="meta">
            ${s.trade ? `<span class="badge">${escapeHtml(s.trade)}</span>` : ""}
            ${used ? `<span class="badge ok">Assigned on this job</span>` : ""}
          </div>
          <div class="meta">
            ${s.phone ? `<a href="tel:${escapeHtml(s.phone)}">${escapeHtml(s.phone)}</a>` : ""}
            ${s.email ? ` • <a href="mailto:${escapeHtml(s.email)}">${escapeHtml(s.email)}</a>` : ""}
          </div>
          ${s.notes ? `<div class="meta">${escapeHtml(s.notes)}</div>` : ""}
        </div>
        <div class="row">
          <button class="btn small" data-action="edit" data-id="${s.id}" type="button">Edit</button>
          <button class="btn small danger" data-action="delete" data-id="${s.id}" type="button">Delete</button>
        </div>
      </div>
    </div>
  `;
}

function projectDeliveries(p){
  const deliveries = state.deliveries
    .filter(d=>d.projectId===p.id)
    .sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  return `
    <div class="card">
      <div class="row space">
        <h2>Deliveries</h2>
        <button class="btn primary" id="addDelivery" type="button">New delivery</button>
      </div>
      <div class="list" id="deliveryListProj">
        ${deliveries.length ? deliveries.map(deliveryRow).join("") : `<div class="sub">No deliveries logged yet.</div>`}
      </div>
    </div>
  `;
}
function deliveryRow(d){
  const badgeClass = d.status==="Delivered" ? "ok" : (d.status==="Missing/Damaged" ? "bad" : "warn");
  return `
    <div class="item">
      <div class="row space">
        <div>
          <div class="title">${escapeHtml(d.supplier || "Delivery")}</div>
          <div class="meta">
            <span class="badge ${badgeClass}">${escapeHtml(d.status||"Expected")}</span>
            ${d.date ? `<span class="badge">📅 ${dateFmt(d.date)}</span>` : ""}
          </div>
          <div class="meta">${escapeHtml((d.items||"").slice(0,180))}</div>
          ${d.dropPoint ? `<div class="meta">Drop: ${escapeHtml(d.dropPoint)}</div>` : ""}
        </div>
        <div class="row">
          <button class="btn small" data-action="edit" data-id="${d.id}" type="button">Edit</button>
          <button class="btn small danger" data-action="delete" data-id="${d.id}" type="button">Delete</button>
        </div>
      </div>
      ${d.photos?.length ? `<div class="thumbgrid">${d.photos.slice(0,6).map(ph=>`<div class="thumb"><img src="${ph.dataUrl}" alt="${escapeHtml(ph.name)}"/></div>`).join("")}</div>` : ""}
    </div>
  `;
}

function projectInspections(p){
  const inspections = state.inspections
    .filter(i=>i.projectId===p.id)
    .sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  const ccc = buildCCCStatus(p.id, inspections);
  return `
    <div class="grid two">
      <div class="card">
        <div class="row space">
          <h2>Inspections</h2>
          <button class="btn primary" id="addInspection" type="button">New inspection</button>
        </div>
        <div class="list" id="inspectionListProj">
          ${inspections.length ? inspections.map(inspectionRow).join("") : `<div class="sub">No inspections scheduled yet.</div>`}
        </div>
      </div>
      <div class="card">
        <h2>CCC tracker</h2>
        <div class="sub">Mark each inspection result to track CCC readiness.</div>
        <hr/>
        ${ccc}
      </div>
    </div>
  `;
}
function inspectionRow(i){
  const cls = i.result==="Pass" ? "ok" : (i.result==="Fail" ? "bad" : "warn");
  return `
    <div class="item">
      <div class="row space">
        <div>
          <div class="title">${escapeHtml(i.type || "Inspection")}</div>
          <div class="meta">
            <span class="badge ${cls}">${escapeHtml(i.result || "Booked")}</span>
            ${i.date ? `<span class="badge">📅 ${dateFmt(i.date)}</span>` : ""}
            ${i.inspector ? `<span class="badge">👤 ${escapeHtml(i.inspector)}</span>` : ""}
          </div>
          ${i.notes ? `<div class="meta">${escapeHtml(i.notes)}</div>` : ""}
        </div>
        <div class="row">
          <button class="btn small" data-action="edit" data-id="${i.id}" type="button">Edit</button>
          <button class="btn small danger" data-action="delete" data-id="${i.id}" type="button">Delete</button>
        </div>
      </div>
      ${i.photos?.length ? `<div class="thumbgrid">${i.photos.slice(0,6).map(ph=>`<div class="thumb"><img src="${ph.dataUrl}" alt="${escapeHtml(ph.name)}"/></div>`).join("")}</div>` : ""}
    </div>
  `;
}
function buildCCCStatus(projectId, inspections){
  // lightweight stage list – editable later
  const stages = ["Pre-slab", "Pre-line", "Post-line", "Final"];
  const rows = stages.map(s=>{
    const done = inspections.filter(i=> (i.type||"").toLowerCase().includes(s.toLowerCase().replace("-","")) && i.result==="Pass").length>0;
    const badge = done ? `<span class="badge ok">✔ Passed</span>` : `<span class="badge warn">⏳ Pending</span>`;
    return `<div class="row space"><div><strong>${escapeHtml(s)}</strong></div><div>${badge}</div></div>`;
  }).join("<hr/>");
  return rows;
}

function projectReports(p){
  return `
    <div class="card">
      <div class="row space">
        <h2>Reports</h2>
        <div class="row">
          <button class="btn" id="hnryExportProj" type="button">Hnry Invoice Export</button>
          <button class="btn primary" id="runProjectReport" type="button">Run Job Report</button>
        </div>
      </div>
      <div class="sub">
        Job Report = printable client/internal summary (diary + tasks + variations + deliveries + inspections).<br/>
        Hnry Export = copy/paste line items from diary entries.
      </div>
    </div>
  `;
}

// ----------------- Tasks (global) -----------------
function renderTasks(app, params){
  setHeader("Tasks");
  const projectId = params.projectId || "";
  const projects = state.projects.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  const tasks = state.tasks
    .filter(t=> !projectId || t.projectId===projectId)
    .slice()
    .sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
  app.innerHTML = `
    <div class="card">
      <div class="row space">
        <h2>Tasks</h2>
        <button class="btn primary" id="newTask" type="button">New Task</button>
      </div>
      <div class="grid two">
        <div>
          <label>Filter by project</label>
          <select id="taskProjectFilter" class="input">
            <option value="">All projects</option>
            ${projects.map(p=>`<option value="${p.id}" ${p.id===projectId?"selected":""}>${escapeHtml(p.name)}</option>`).join("")}
          </select>
        </div>
        <div></div>
      </div>
      <hr/>
      <div class="list" id="taskList">${tasks.length ? tasks.map(taskRowWithProject).join("") : `<div class="sub">No tasks yet.</div>`}</div>
    </div>
  `;
  $("#newTask").onclick = ()=> openTaskForm(projectId ? { projectId } : {});
  $("#taskProjectFilter").onchange = (e)=>{
    const v = e.target.value;
    navTo("tasks", v ? {projectId:v} : {});
  };
  $$("#taskList [data-action='edit']").forEach(b=>b.onclick = ()=> openTaskForm(state.tasks.find(t=>t.id===b.dataset.id)));
  $$("#taskList [data-action='delete']").forEach(b=>b.onclick = ()=>{
    const t = state.tasks.find(x=>x.id===b.dataset.id);
    if(t && confirmDelete(`task "${t.title}"`)){
      state.tasks = state.tasks.filter(x=>x.id!==t.id);
      saveState(state); render();
    }
  });
}
function taskRowWithProject(t){
  const p = projectById(t.projectId);
  return `
    <div class="item">
      <div class="row space">
        <div>
          <div class="title">${escapeHtml(t.title)}</div>
          <div class="meta">${p ? escapeHtml(p.name) : "No project"}</div>
          <div class="meta">${escapeHtml(t.status||"To do")}${t.dueDate ? ` • Due ${dateFmt(t.dueDate)}` : ""}</div>
        </div>
        <div class="row">
          <button class="btn small" data-action="edit" data-id="${t.id}" type="button">Edit</button>
          <button class="btn small danger" data-action="delete" data-id="${t.id}" type="button">Delete</button>
        </div>
      </div>
      ${t.photos?.length ? `<div class="thumbgrid">${t.photos.slice(0,6).map(ph=>`<div class="thumb"><img src="${ph.dataUrl}" alt="${escapeHtml(ph.name)}"/></div>`).join("")}</div>` : ""}
    </div>
  `;
}

function openTaskForm(seed={}){
  const isEdit = !!seed.id;
  const t = isEdit ? seed : {
    id: uid(),
    projectId: seed.projectId || (state.projects[0]?.id || ""),
    title: "",
    details: "",
    status: "To do",
    dueDate: "",
    assignedSubbieId: null,
    photos: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const projects = state.projects.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  const subbies = state.subbies.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  showModal(`
    <div class="row space">
      <h2>${isEdit ? "Edit Task" : "New Task"}</h2>
      <button class="btn" id="closeM" type="button">Close</button>
    </div>
    <label>Project</label>
    <select id="t_project" class="input">
      ${projects.map(p=>`<option value="${p.id}" ${p.id===t.projectId?"selected":""}>${escapeHtml(p.name)}</option>`).join("")}
    </select>
    <label>Title</label>
    <input id="t_title" class="input" value="${escapeHtml(t.title)}" placeholder="e.g., Fit off bathroom, fix jamb, order LVL" />
    <label>Details</label>
    <textarea id="t_details" class="input" placeholder="Notes for you / subbie">${escapeHtml(t.details||"")}</textarea>
    <div class="grid two">
      <div>
        <label>Status</label>
        <select id="t_status" class="input">
          ${["To do","In progress","Blocked","Done"].map(s=>`<option ${s===t.status?"selected":""}>${s}</option>`).join("")}
        </select>
      </div>
      <div>
        <label>Due date</label>
        <input id="t_due" class="input" type="date" value="${escapeHtml(t.dueDate||"")}" />
      </div>
    </div>
    <label>Assign to subbie (optional)</label>
    <select id="t_subbie" class="input">
      <option value="">Unassigned</option>
      ${subbies.map(s=>`<option value="${s.id}" ${s.id===t.assignedSubbieId?"selected":""}>${escapeHtml(s.name)}${s.trade?` — ${escapeHtml(s.trade)}`:""}</option>`).join("")}
    </select>

    <label>Photos (camera or camera roll)</label>
    <input id="t_photos" class="input" type="file" accept="image/*" multiple />

    ${t.photos?.length ? `<div class="thumbgrid">${t.photos.map(ph=>`
      <div class="thumb" title="${escapeHtml(ph.name)}"><img src="${ph.dataUrl}" alt="${escapeHtml(ph.name)}"/></div>
    `).join("")}</div>` : ""}

    <hr/>
    <div class="row space actionsSticky">
      <button class="btn primary" id="saveT" type="button">${isEdit ? "Save" : "Create"}</button>
      <button class="btn" id="cancelT" type="button">Cancel</button>
      ${isEdit ? `<button class="btn danger" id="delT" type="button">Delete</button>` : ""}
    </div>
  `);
  $("#closeM").onclick = closeModal;
  $("#cancelT").onclick = closeModal;

  $("#saveT").onclick = async ()=>{
    const __btn = $("#saveT");
    setBtnBusy(__btn, true);
    const __hint = showSavingHint("Saving…");
    try{
    const added = await filesToDataUrls($("#t_photos").files);
    t.projectId = $("#t_project").value;
    t.title = $("#t_title").value.trim();
    t.details = $("#t_details").value.trim();
    t.status = $("#t_status").value;
    t.dueDate = $("#t_due").value;
    t.assignedSubbieId = $("#t_subbie").value || null;
    t.photos = [...(t.photos||[]), ...added];
    t.updatedAt = new Date().toISOString();
    if(!t.title){ alert("Title required."); return; }
    if(isEdit){
      state.tasks = state.tasks.map(x=>x.id===t.id ? t : x);
    }else{
      state.tasks.unshift(t);
    }
    await saveState(state);
    closeModal();
    render();
    } finally {
      __hint && __hint.remove();
      setBtnBusy(__btn, false);
    }

  };

  $("#delT") && ($("#delT").onclick = ()=>{
    if(confirmDelete(`task "${t.title}"`)){
      state.tasks = state.tasks.filter(x=>x.id!==t.id);
      await saveState(state);
      closeModal();
      render();
    }
  });
}

// ----------------- Diary (global) -----------------

function openDiaryView(d){
  if(!d) return;
  const p = (state.projects||[]).find(x=>x.id===d.projectId);
  showModal(`
    <div class="row space">
      <h2>Diary Entry</h2>
      <div class="row">
        <button class="btn" id="closeM" type="button">Close</button>
        <button class="btn primary" id="editV" type="button">Edit</button>
      </div>
    </div>
    <div class="sub"><strong>${escapeHtml(p?.name || "Project")}</strong><br/>${escapeHtml(p?.address || "")}</div>
    <hr/>
    <div class="kv"><div class="k">Date</div><div class="v">${escapeHtml(dateFmt(d.date))}</div></div>
    <div class="kv"><div class="k">Category</div><div class="v">${escapeHtml(d.category||"")}</div></div>
    <div class="kv"><div class="k">Billable</div><div class="v">${d.billable ? "Yes" : "No"}</div></div>
    ${d.hours ? `<div class="kv"><div class="k">Hours</div><div class="v">${escapeHtml(String(d.hours))}</div></div>` : ""}
    ${d.rate ? `<div class="kv"><div class="k">Rate</div><div class="v">${escapeHtml(String(d.rate))}</div></div>` : ""}
    <hr/>
    <h2 style="margin-top:0">Notes</h2>
    <div class="sub" style="white-space:pre-wrap">${escapeHtml(d.summary||"—")}</div>
    ${d.photos?.length ? `<hr/><h2 style="margin-top:0">Photos</h2><div class="thumbgrid">${d.photos.map(ph=>`<div class="thumb"><img src="${ph.dataUrl}" alt="${escapeHtml(ph.name)}"/></div>`).join("")}</div>` : ""}
  `);
  $("#closeM").onclick = closeModal;
  $("#editV").onclick = ()=> openDiaryForm(d);
}
function renderDiary(app, params){
  setHeader("Diary");
  const projectId = params.projectId || "";
  const projects = state.projects.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  const entries = state.diary
    .filter(d=> !projectId || d.projectId===projectId)
    .slice()
    .sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  app.innerHTML = `
    <div class="card">
      <div class="row space">
        <h2>Diary</h2>
        <button class="btn primary" id="newDiary" type="button">New Entry</button>
      </div>
      <div class="grid two">
        <div>
          <label>Filter by project</label>
          <select id="diaryProjectFilter" class="input">
            <option value="">All projects</option>
            ${projects.map(p=>`<option value="${p.id}" ${p.id===projectId?"selected":""}>${escapeHtml(p.name)}</option>`).join("")}
          </select>
        </div>
        <div></div>
      </div>
      <hr/>
      <div class="list" id="diaryList">${entries.length ? entries.map(diaryRowWithProject).join("") : `<div class="sub">No diary entries yet.</div>`}</div>
    </div>
  `;
  $("#newDiary").onclick = ()=> openDiaryForm(projectId ? { projectId } : {});
  $("#diaryProjectFilter").onchange = (e)=>{
    const v = e.target.value;
    navTo("diary", v ? {projectId:v} : {});
  };
  $$("#diaryList [data-action='edit']").forEach(b=>b.onclick = ()=> openDiaryForm(state.diary.find(d=>d.id===b.dataset.id)));
  $$("#diaryList [data-action='delete']").forEach(b=>b.onclick = ()=>{
    const d = state.diary.find(x=>x.id===b.dataset.id);
    if(d && confirmDelete(`diary entry ${dateFmt(d.date)}`)){
      state.diary = state.diary.filter(x=>x.id!==d.id);
      saveState(state); render();
    }
  });
}
function diaryRowWithProject(d){
  const p = projectById(d.projectId);
  return `
    <div class="item">
      <div class="row space">
        <div>
          <div class="title">${dateFmt(d.date)}</div>
          <div class="meta">${p ? escapeHtml(p.name) : "No project"}</div>
          <div class="meta">${escapeHtml((d.summary||"").slice(0,160))}</div>
        </div>
        <div class="row">
          <button class="btn small" data-action="edit" data-id="${d.id}" type="button">Edit</button>
          <button class="btn small danger" data-action="delete" data-id="${d.id}" type="button">Delete</button>
        </div>
      </div>
      ${d.photos?.length ? `<div class="thumbgrid">${d.photos.slice(0,6).map(ph=>`<div class="thumb"><img src="${ph.dataUrl}" alt="${escapeHtml(ph.name)}"/></div>`).join("")}</div>` : ""}
    </div>
  `;
}

function openDiaryForm(seed={}){
  const isEdit = !!seed.id;
  const d = isEdit ? seed : {
    id: uid(),
    projectId: seed.projectId || (state.projects[0]?.id || ""),
    date: new Date().toISOString().slice(0,10),
    summary: "",
    hours: "",
    billable: true,
    category: "Labour",
    rate: "",
    photos: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const projects = state.projects.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  showModal(`
    <div class="row space">
      <h2>${isEdit ? "Edit Diary Entry" : "New Diary Entry"}</h2>
      <button class="btn" id="closeM" type="button">Close</button>
    </div>
    <label>Project</label>
    <select id="d_project" class="input">
      ${projects.map(p=>`<option value="${p.id}" ${p.id===d.projectId?"selected":""}>${escapeHtml(p.name)}</option>`).join("")}
    </select>
    <div class="grid two">
      <div>
        <label>Date</label>
        <input id="d_date" class="input" type="date" value="${escapeHtml(d.date)}" />
      </div>
      <div>
        <label>Hours (optional)</label>
        <input id="d_hours" class="input" type="number" step="0.25" value="${escapeHtml(d.hours||"")}" placeholder="e.g., 7.5" />
      </div>
    </div>
    <div class="grid two">
      <div>
        <label>Category</label>
        <select id="d_cat" class="input">
          ${["Labour","Materials","Travel","Plant","Other"].map(c=>`<option ${c===d.category?"selected":""}>${c}</option>`).join("")}
        </select>
      </div>
      <div>
        <label>Billable</label>
        <select id="d_bill" class="input">
          <option value="true" ${d.billable?"selected":""}>Yes</option>
          <option value="false" ${!d.billable?"selected":""}>No</option>
        </select>
      </div>
    </div>
    <label>Rate (NZD/hr or item cost) — optional</label>
    <input id="d_rate" class="input" type="number" step="0.01" value="${escapeHtml(d.rate||"")}" placeholder="Leave blank to use default labour rate in Settings" />
    <label>Summary / notes</label>
    <textarea id="d_sum" class="input" placeholder="What was done today?">${escapeHtml(d.summary||"")}</textarea>
    <label>Photos (camera or camera roll)</label>
    <input id="d_photos" class="input" type="file" accept="image/*" multiple />

    ${d.photos?.length ? `<div class="thumbgrid">${d.photos.map(ph=>`
      <div class="thumb" title="${escapeHtml(ph.name)}"><img src="${ph.dataUrl}" alt="${escapeHtml(ph.name)}"/></div>
    `).join("")}</div>` : ""}

    <hr/>
    <div class="row space actionsSticky">
      <button class="btn primary" id="saveD" type="button">${isEdit ? "Save" : "Create"}</button>
      <button class="btn" id="cancelD" type="button">Cancel</button>
      ${isEdit ? `<button class="btn danger" id="delD" type="button">Delete</button>` : ""}
    </div>
  `);
  $("#closeM").onclick = closeModal;
  $("#cancelD").onclick = closeModal;

  $("#saveD").onclick = async ()=>{
    const __btn = $("#saveD");
    setBtnBusy(__btn, true);
    const __hint = showSavingHint("Saving…");
    try{
    const added = await filesToDataUrls($("#d_photos").files);
    d.projectId = $("#d_project").value;
    d.date = $("#d_date").value;
    d.hours = $("#d_hours").value;
    d.category = $("#d_cat").value;
    d.billable = $("#d_bill").value === "true";
    d.rate = $("#d_rate").value;
    d.summary = $("#d_sum").value.trim();
    d.photos = [...(d.photos||[]), ...added];
    d.updatedAt = new Date().toISOString();
    if(!d.projectId){ alert("Project required."); return; }
    if(!d.date){ alert("Date required."); return; }
    if(isEdit){
      state.diary = state.diary.map(x=>x.id===d.id ? d : x);
    }else{
      state.diary.unshift(d);
    }
    await saveState(state);
    closeModal();
    render();
    } finally {
      __hint && __hint.remove();
      setBtnBusy(__btn, false);
    }

  };

  $("#delD") && ($("#delD").onclick = ()=>{
    if(confirmDelete(`diary entry ${dateFmt(d.date)}`)){
      state.diary = state.diary.filter(x=>x.id!==d.id);
      await saveState(state);
      closeModal();
      render();
    }
  });
}

// ----------------- Variations (global list is via project) -----------------
function openVariationForm(seed={}){
  const isEdit = !!seed.id;
  const v = isEdit ? seed : {
    id: uid(),
    projectId: seed.projectId || (state.projects[0]?.id || ""),
    date: new Date().toISOString().slice(0,10),
    title: "",
    description: "",
    amount: "",
    status: "Draft",
    photos: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const projects = state.projects.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  showModal(`
    <div class="row space">
      <h2>${isEdit ? "Edit Variation" : "New Variation"}</h2>
      <button class="btn" id="closeM" type="button">Close</button>
    </div>
    <label>Project</label>
    <select id="v_project" class="input">
      ${projects.map(p=>`<option value="${p.id}" ${p.id===v.projectId?"selected":""}>${escapeHtml(p.name)}</option>`).join("")}
    </select>
    <div class="grid two">
      <div>
        <label>Date</label>
        <input id="v_date" class="input" type="date" value="${escapeHtml(v.date||"")}" />
      </div>
      <div>
        <label>Status</label>
        <select id="v_status" class="input">
          ${["Draft","Sent","Approved","Declined"].map(s=>`<option ${s===v.status?"selected":""}>${s}</option>`).join("")}
        </select>
      </div>
    </div>
    <label>Title</label>
    <input id="v_title" class="input" value="${escapeHtml(v.title||"")}" placeholder="e.g., Extra soffit lining / Change of tiles" />
    <label>Description</label>
    <textarea id="v_desc" class="input" placeholder="Scope change, photos, notes">${escapeHtml(v.description||"")}</textarea>
    <label>Amount (NZD)</label>
    <input id="v_amount" class="input" type="number" step="0.01" value="${escapeHtml(v.amount||"")}" />
    <label>Photos</label>
    <input id="v_photos" class="input" type="file" accept="image/*" multiple />
    ${v.photos?.length ? `<div class="thumbgrid">${v.photos.map(ph=>`<div class="thumb"><img src="${ph.dataUrl}" alt="${escapeHtml(ph.name)}"/></div>`).join("")}</div>` : ""}
    <hr/>
    <div class="row space actionsSticky">
      <button class="btn primary" id="saveV" type="button">${isEdit ? "Save" : "Create"}</button>
      <button class="btn" id="cancelV" type="button">Cancel</button>
      ${isEdit ? `<button class="btn danger" id="delV" type="button">Delete</button>` : ""}
    </div>
  `);
  $("#closeM").onclick = closeModal;
  $("#cancelV").onclick = closeModal;

  $("#saveV").onclick = async ()=>{
    const __btn = $("#saveV");
    setBtnBusy(__btn, true);
    const __hint = showSavingHint("Saving…");
    try{
    const added = await filesToDataUrls($("#v_photos").files);
    v.projectId = $("#v_project").value;
    v.date = $("#v_date").value;
    v.status = $("#v_status").value;
    v.title = $("#v_title").value.trim();
    v.description = $("#v_desc").value.trim();
    v.amount = $("#v_amount").value;
    v.photos = [...(v.photos||[]), ...added];
    v.updatedAt = new Date().toISOString();
    if(!v.title) alert("Title required.");
    if(isEdit){
      state.variations = state.variations.map(x=>x.id===v.id ? v : x);
    }else{
      state.variations.unshift(v);
    }
    saveState(state);
    closeModal();
    render();
    } finally {
      __hint && __hint.remove();
      setBtnBusy(__btn, false);
    }

  };

  $("#delV") && ($("#delV").onclick = ()=>{
    if(confirmDelete(`variation "${v.title}"`)){
      state.variations = state.variations.filter(x=>x.id!==v.id);
      saveState(state);
      closeModal();
      render();
    }
  });
}

// ----------------- Subbies -----------------
function openSubbieForm(seed=null){
  const isEdit = !!seed?.id;
  const s = isEdit ? seed : { id: uid(), name:"", trade:"", phone:"", email:"", notes:"", createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
  showModal(`
    <div class="row space">
      <h2>${isEdit ? "Edit Subbie" : "Add Subbie"}</h2>
      <button class="btn" id="closeM" type="button">Close</button>
    </div>
    <label>Name</label>
    <input id="s_name" class="input" value="${escapeHtml(s.name||"")}" placeholder="Company or person" />
    <label>Trade</label>
    <input id="s_trade" class="input" value="${escapeHtml(s.trade||"")}" placeholder="e.g., Plumber, Sparky, Gib, Painter" />
    <div class="grid two">
      <div>
        <label>Phone</label>
        <input id="s_phone" class="input" value="${escapeHtml(s.phone||"")}" />
      </div>
      <div>
        <label>Email</label>
        <input id="s_email" class="input" value="${escapeHtml(s.email||"")}" />
      </div>
    </div>
    <label>Notes</label>
    <textarea id="s_notes" class="input">${escapeHtml(s.notes||"")}</textarea>
    <hr/>
    <div class="row space actionsSticky">
      <button class="btn primary" id="saveS" type="button">${isEdit ? "Save" : "Add"}</button>
      <button class="btn" id="cancelS" type="button">Cancel</button>
      ${isEdit ? `<button class="btn danger" id="delS" type="button">Delete</button>` : ""}
    </div>
  `);
  $("#closeM").onclick = closeModal;
  $("#cancelS").onclick = closeModal;

  $("#saveS").onclick = ()=>{
    s.name = $("#s_name").value.trim();
    s.trade = $("#s_trade").value.trim();
    s.phone = $("#s_phone").value.trim();
    s.email = $("#s_email").value.trim();
    s.notes = $("#s_notes").value.trim();
    s.updatedAt = new Date().toISOString();
    if(!s.name) alert("Name required.");
    if(isEdit){
      state.subbies = state.subbies.map(x=>x.id===s.id ? s : x);
    }else{
      state.subbies.unshift(s);
    }
    saveState(state);
    closeModal();
    render();
  };

  $("#delS") && ($("#delS").onclick = ()=>{
    if(confirmDelete(`subbie "${s.name}"`)){
      state.subbies = state.subbies.filter(x=>x.id!==s.id);
      state.tasks = state.tasks.map(t=> t.assignedSubbieId===s.id ? {...t, assignedSubbieId:null} : t);
      saveState(state);
      closeModal();
      render();
    }
  });
}

// ----------------- Deliveries -----------------
function openDeliveryForm(seed={}){
  const isEdit = !!seed?.id;
  const d = isEdit ? seed : {
    id: uid(),
    projectId: seed.projectId || (state.projects[0]?.id || ""),
    supplier: "",
    date: new Date().toISOString().slice(0,10),
    status: "Expected",
    items: "",
    dropPoint: "",
    notes: "",
    photos: [],
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
  const projects = state.projects.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  showModal(`
    <div class="row space">
      <h2>${isEdit ? "Edit Delivery" : "New Delivery"}</h2>
      <button class="btn" id="closeM" type="button">Close</button>
    </div>
    <label>Project</label>
    <select id="del_project" class="input">
      ${projects.map(p=>`<option value="${p.id}" ${p.id===d.projectId?"selected":""}>${escapeHtml(p.name)}</option>`).join("")}
    </select>
    <div class="grid two">
      <div>
        <label>Supplier</label>
        <input id="del_supplier" class="input" value="${escapeHtml(d.supplier||"")}" placeholder="PlaceMakers / Carters / Mitre10 / ITM / etc" />
      </div>
      <div>
        <label>Date</label>
        <input id="del_date" class="input" type="date" value="${escapeHtml(d.date||"")}" />
      </div>
    </div>
    <label>Status</label>
    <select id="del_status" class="input">
      ${["Expected","Delivered","Missing/Damaged"].map(s=>`<option ${s===d.status?"selected":""}>${s}</option>`).join("")}
    </select>
    <label>Items</label>
    <textarea id="del_items" class="input" placeholder="What’s coming / what arrived">${escapeHtml(d.items||"")}</textarea>
    <label>Drop point</label>
    <input id="del_drop" class="input" value="${escapeHtml(d.dropPoint||"")}" placeholder="Front gate / garage / upstairs / etc" />
    <label>Notes</label>
    <textarea id="del_notes" class="input">${escapeHtml(d.notes||"")}</textarea>
    <label>Photos</label>
    <input id="del_photos" class="input" type="file" accept="image/*" multiple />
    ${d.photos?.length ? `<div class="thumbgrid">${d.photos.map(ph=>`<div class="thumb"><img src="${ph.dataUrl}" alt="${escapeHtml(ph.name)}"/></div>`).join("")}</div>` : ""}
    <hr/>
    <div class="row space actionsSticky">
      <button class="btn primary" id="saveDel" type="button">${isEdit ? "Save" : "Create"}</button>
      <button class="btn" id="cancelDel" type="button">Cancel</button>
      ${isEdit ? `<button class="btn danger" id="delDel" type="button">Delete</button>` : ""}
    </div>
  `);
  $("#closeM").onclick = closeModal;
  $("#cancelDel").onclick = closeModal;

  $("#saveDel").onclick = async ()=>{
    const __btn = $("#saveDel");
    setBtnBusy(__btn, true);
    const __hint = showSavingHint("Saving…");
    try{
    const added = await filesToDataUrls($("#del_photos").files);
    d.projectId = $("#del_project").value;
    d.supplier = $("#del_supplier").value.trim();
    d.date = $("#del_date").value;
    d.status = $("#del_status").value;
    d.items = $("#del_items").value.trim();
    d.dropPoint = $("#del_drop").value.trim();
    d.notes = $("#del_notes").value.trim();
    d.photos = [...(d.photos||[]), ...added];
    d.updatedAt = new Date().toISOString();
    if(!d.projectId) alert("Project required.");
    if(isEdit){
      state.deliveries = state.deliveries.map(x=>x.id===d.id ? d : x);
    }else{
      state.deliveries.unshift(d);
    }
    saveState(state);
    closeModal();
    render();
    } finally {
      __hint && __hint.remove();
      setBtnBusy(__btn, false);
    }

  };

  $("#delDel") && ($("#delDel").onclick = ()=>{
    if(confirmDelete(`delivery "${d.supplier||'delivery'}"`)){
      state.deliveries = state.deliveries.filter(x=>x.id!==d.id);
      saveState(state);
      closeModal();
      render();
    }
  });
}

// ----------------- Inspections -----------------
function openInspectionForm(seed={}){
  const isEdit = !!seed?.id;
  const i = isEdit ? seed : {
    id: uid(),
    projectId: seed.projectId || (state.projects[0]?.id || ""),
    type: "Pre-line",
    date: "",
    result: "Booked",
    inspector: "",
    notes: "",
    photos: [],
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
  const projects = state.projects.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  showModal(`
    <div class="row space">
      <h2>${isEdit ? "Edit Inspection" : "New Inspection"}</h2>
      <button class="btn" id="closeM" type="button">Close</button>
    </div>
    <label>Project</label>
    <select id="i_project" class="input">
      ${projects.map(p=>`<option value="${p.id}" ${p.id===i.projectId?"selected":""}>${escapeHtml(p.name)}</option>`).join("")}
    </select>
    <div class="grid two">
      <div>
        <label>Type</label>
        <input id="i_type" class="input" value="${escapeHtml(i.type||"")}" placeholder="Pre-slab / Pre-line / Post-line / Final / etc" />
      </div>
      <div>
        <label>Date</label>
        <input id="i_date" class="input" type="date" value="${escapeHtml(i.date||"")}" />
      </div>
    </div>
    <label>Result</label>
    <select id="i_result" class="input">
      ${["Booked","Pass","Fail","Conditional"].map(r=>`<option ${r===i.result?"selected":""}>${r}</option>`).join("")}
    </select>
    <label>Inspector</label>
    <input id="i_insp" class="input" value="${escapeHtml(i.inspector||"")}" placeholder="Optional" />
    <label>Notes</label>
    <textarea id="i_notes" class="input">${escapeHtml(i.notes||"")}</textarea>
    <label>Photos</label>
    <input id="i_photos" class="input" type="file" accept="image/*" multiple />
    ${i.photos?.length ? `<div class="thumbgrid">${i.photos.map(ph=>`<div class="thumb"><img src="${ph.dataUrl}" alt="${escapeHtml(ph.name)}"/></div>`).join("")}</div>` : ""}
    <hr/>
    <div class="row space actionsSticky">
      <button class="btn primary" id="saveI" type="button">${isEdit ? "Save" : "Create"}</button>
      <button class="btn" id="cancelI" type="button">Cancel</button>
      ${isEdit ? `<button class="btn danger" id="delI" type="button">Delete</button>` : ""}
    </div>
  `);
  $("#closeM").onclick = closeModal;
  $("#cancelI").onclick = closeModal;

  $("#saveI").onclick = async ()=>{
    const __btn = $("#saveI");
    setBtnBusy(__btn, true);
    const __hint = showSavingHint("Saving…");
    try{
    const added = await filesToDataUrls($("#i_photos").files);
    i.projectId = $("#i_project").value;
    i.type = $("#i_type").value.trim();
    i.date = $("#i_date").value;
    i.result = $("#i_result").value;
    i.inspector = $("#i_insp").value.trim();
    i.notes = $("#i_notes").value.trim();
    i.photos = [...(i.photos||[]), ...added];
    i.updatedAt = new Date().toISOString();
    if(!i.projectId) alert("Project required.");
    if(!i.type) alert("Type required.");
    if(isEdit){
      state.inspections = state.inspections.map(x=>x.id===i.id ? i : x);
    }else{
      state.inspections.unshift(i);
    }
    saveState(state);
    closeModal();
    render();
    } finally {
      __hint && __hint.remove();
      setBtnBusy(__btn, false);
    }

  };

  $("#delI") && ($("#delI").onclick = ()=>{
    if(confirmDelete(`inspection "${i.type}"`)){
      state.inspections = state.inspections.filter(x=>x.id!==i.id);
      saveState(state);
      closeModal();
      render();
    }
  });
}

// ----------------- Reports -----------------
function renderReports(app){
  setHeader("Reports");
  const projects = state.projects.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  app.innerHTML = `
    <div class="card">
      <div class="row space">
        <h2>Reports</h2>
        <div class="row">
          <button class="btn" id="hnryExport" type="button">Hnry Invoice Export</button>
          <button class="btn primary" id="runReport" type="button">Run Job Report</button>
        </div>
      </div>
      <div class="grid two">
        <div>
          <label>Project</label>
          <select id="r_project" class="input">
            ${projects.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
          </select>
        </div>
        <div></div>
      </div>
      <div class="grid two">
        <div>
          <label>Date from</label>
          <input id="r_from" class="input" type="date" value="${new Date(Date.now()-7*86400000).toISOString().slice(0,10)}" />
        </div>
        <div>
          <label>Date to</label>
          <input id="r_to" class="input" type="date" value="${new Date().toISOString().slice(0,10)}" />
        </div>
      </div>
      <div class="sub">Reports open in a printable preview. Use your browser share/print to save as PDF.</div>
    </div>
  `;
  $("#runReport").onclick = ()=>{
    const pid = $("#r_project").value;
    runReportUI(pid, $("#r_from").value, $("#r_to").value);
  };
  $("#hnryExport").onclick = ()=>{
    const pid = $("#r_project").value;
    runHnryExportUI(pid, $("#r_from").value, $("#r_to").value);
  };
}

function runReportUI(projectId, from=null, to=null){
  const p = projectById(projectId);
  if(!p) return;
  const rangeFrom = from || new Date(Date.now()-7*86400000).toISOString().slice(0,10);
  const rangeTo = to || new Date().toISOString().slice(0,10);

  const tasks = state.tasks.filter(t=>t.projectId===projectId);
  const diary = state.diary.filter(d=>d.projectId===projectId).filter(d=>d.date>=rangeFrom && d.date<=rangeTo).sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  const vars = state.variations.filter(v=>v.projectId===projectId).filter(v=> (v.date||"")>=rangeFrom && (v.date||"")<=rangeTo);
  const delivs = state.deliveries.filter(d=>d.projectId===projectId).filter(d=> (d.date||"")>=rangeFrom && (d.date||"")<=rangeTo);
  const insps = state.inspections.filter(i=>i.projectId===projectId).filter(i=> (i.date||"")>=rangeFrom && (i.date||"")<=rangeTo);

  const html = `
    <div class="card printOnly" style="padding:18px">
      <div style="display:flex; gap:14px; align-items:center">
        <img src="./logo.png" alt="logo" style="height:44px; width:auto"/>
        <div>
          <div style="font-size:18px; font-weight:900">${escapeHtml(settings.companyName)}</div>
          <div style="color:#333; font-size:12px">${escapeHtml(p.name)} • ${escapeHtml(p.address||"")}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="row space">
        <h2>Job Report</h2>
        <div class="row noPrint">
          <button class="btn" id="copyLink" type="button">Copy</button>
          <button class="btn primary" id="printBtn" type="button">Print / Save PDF</button>
        </div>
      </div>
      <div class="sub">${escapeHtml(p.name)} • ${escapeHtml(p.address||"")}<br/>Period: ${dateFmt(rangeFrom)} → ${dateFmt(rangeTo)}</div>
      <hr/>
      <h2>Diary</h2>
      ${diary.length ? diary.map(d=>`
        <div class="item">
          <div class="row space">
            <div><strong>${dateFmt(d.date)}</strong> ${d.billable?`<span class="badge ok">Billable</span>`:`<span class="badge">Non‑billable</span>`} ${d.hours?`<span class="badge">⏱ ${escapeHtml(String(d.hours))}h</span>`:""}</div>
            <div class="smallmuted">${escapeHtml(d.category||"")}</div>
          </div>
          <div class="meta">${escapeHtml(d.summary||"")}</div>
        </div>
      `).join("") : `<div class="sub">No diary entries in range.</div>`}

      <hr/>
      <h2>Open tasks</h2>
      ${tasks.filter(t=>t.status!=="Done").length ? `
        <table>
          <thead><tr><th>Task</th><th>Status</th><th>Due</th><th>Assigned</th></tr></thead>
          <tbody>
            ${tasks.filter(t=>t.status!=="Done").map(t=>{
              const s = t.assignedSubbieId ? subbieById(t.assignedSubbieId) : null;
              return `<tr><td>${escapeHtml(t.title)}</td><td>${escapeHtml(t.status||"")}</td><td>${t.dueDate?escapeHtml(dateFmt(t.dueDate)):""}</td><td>${s?escapeHtml(s.name):""}</td></tr>`;
            }).join("")}
          </tbody>
        </table>` : `<div class="sub">No open tasks.</div>`}

      <hr/>
      <h2>Variations</h2>
      ${vars.length ? `
        <table>
          <thead><tr><th>Title</th><th>Status</th><th>Date</th><th>Amount</th></tr></thead>
          <tbody>
            ${vars.map(v=>`<tr><td>${escapeHtml(v.title)}</td><td>${escapeHtml(v.status||"")}</td><td>${v.date?escapeHtml(dateFmt(v.date)):""}</td><td>${v.amount?escapeHtml(money(v.amount)):""}</td></tr>`).join("")}
          </tbody>
        </table>` : `<div class="sub">No variations in range.</div>`}

      <hr/>
      <h2>Deliveries</h2>
      ${delivs.length ? `
        <table>
          <thead><tr><th>Supplier</th><th>Date</th><th>Status</th><th>Items</th></tr></thead>
          <tbody>
            ${delivs.map(d=>`<tr><td>${escapeHtml(d.supplier||"")}</td><td>${d.date?escapeHtml(dateFmt(d.date)):""}</td><td>${escapeHtml(d.status||"")}</td><td>${escapeHtml((d.items||"").slice(0,120))}</td></tr>`).join("")}
          </tbody>
        </table>` : `<div class="sub">No deliveries in range.</div>`}

      <hr/>
      <h2>Inspections</h2>
      ${insps.length ? `
        <table>
          <thead><tr><th>Type</th><th>Date</th><th>Result</th><th>Notes</th></tr></thead>
          <tbody>
            ${insps.map(i=>`<tr><td>${escapeHtml(i.type||"")}</td><td>${i.date?escapeHtml(dateFmt(i.date)):""}</td><td>${escapeHtml(i.result||"")}</td><td>${escapeHtml((i.notes||"").slice(0,120))}</td></tr>`).join("")}
          </tbody>
        </table>` : `<div class="sub">No inspections in range.</div>`}

      <hr/>
      <div class="smallmuted">Generated ${new Date().toLocaleString("en-NZ")}</div>
    </div>
  `;

  // open in same app as modal with print
  showModal(html);
  $("#copyLink").onclick = async ()=>{
    try{
      await navigator.clipboard.writeText(`Job Report: ${p.name} (${rangeFrom} to ${rangeTo})`);
      alert("Copied.");
    }catch(e){ alert("Copy failed."); }
  };
  $("#printBtn").onclick = ()=> window.print();
}

function runHnryExportUI(projectId, from=null, to=null){
  const p = projectById(projectId);
  if(!p) return;
  const rangeFrom = from || new Date(Date.now()-7*86400000).toISOString().slice(0,10);
  const rangeTo = to || new Date().toISOString().slice(0,10);

  const diary = state.diary
    .filter(d=>d.projectId===projectId)
    .filter(d=>d.date>=rangeFrom && d.date<=rangeTo)
    .filter(d=>d.billable)
    .sort((a,b)=>(a.date||"").localeCompare(b.date||""));

  const totalBillableHours = diary.reduce((s,d)=> s + Number(d.hours || 0), 0);
  const labourHours = diary.filter(d=> (d.category||'')==='Labour').reduce((s,d)=> s + Number(d.hours || 0), 0);


  // Summarise into line items by category
  const lines = {};
  for(const d of diary){
    const cat = d.category || "Other";
    if(!lines[cat]) lines[cat] = { hours:0, amount:0, notes:[] };
    const hrs = Number(d.hours || 0);
    const rate = d.rate ? Number(d.rate) : (cat==="Labour" ? Number(settings.labourRate||0) : 0);
    lines[cat].hours += hrs;
    // amount: if materials/travel etc and no hours, interpret d.rate as amount if provided
    if(cat==="Labour"){
      lines[cat].amount += hrs * rate;
    }else{
      const amt = d.rate ? Number(d.rate) : 0;
      lines[cat].amount += amt;
    }
    if(d.summary) lines[cat].notes.push(d.summary);
  }

  const outLines = Object.entries(lines).map(([cat,v])=>{
    if(cat==="Labour"){
      return `${settings.companyName} – ${p.name}\n${cat} (${v.hours.toFixed(2)} hrs)    ${money(v.amount)}`;
    }
    return `${cat}    ${money(v.amount)}`;
  });

  const total = Object.values(lines).reduce((s,v)=> s + (v.amount||0), 0);

  const block = [
    settings.companyName,
    `Project: ${p.name}`,
    p.address ? `Address: ${p.address}` : "",
    `Period: ${rangeFrom} to ${rangeTo}`,
    "",
    ...Object.entries(lines).map(([cat,v])=>{
      if(cat==="Labour") return `Site labour – ${p.name} (${v.hours.toFixed(2)} hrs)    ${money(v.amount)}`;
      return `${cat}    ${money(v.amount)}`;
    }),
    "",
    `Total billable hours:    ${totalBillableHours.toFixed(2)} h`,
    `Labour hours:    ${labourHours.toFixed(2)} h`,
    `Total (ex GST):    ${money(total)}`
  ].filter(Boolean).join("\n");

  showModal(`
    <div class="row space">
      <h2>Hnry Invoice Export</h2>
      <div class="row">
        <button class="btn" id="copyH" type="button">Copy</button>
        <button class="btn" id="closeM" type="button">Close</button>
      </div>
    </div>
    <div class="sub">Copy/paste into Hnry invoice line items. Uses billable diary entries only.</div>
    <hr/>
    <textarea class="input" id="hnryBlock" style="min-height:260px">${escapeHtml(block)}</textarea>
    <div class="smallmuted">Billable hours: <strong>${totalBillableHours.toFixed(2)}h</strong> (Labour: ${labourHours.toFixed(2)}h). Tip: set your default labour rate in Settings.</div>
  `);
  $("#closeM").onclick = closeModal;
  $("#copyH").onclick = async ()=>{
    try{
      await navigator.clipboard.writeText(block);
      alert("Copied.");
    }catch(e){
      alert("Copy failed.");
    }
  };
}

// ----------------- Settings -----------------
function renderSettings(app){
  setHeader("Settings");
  app.innerHTML = `
    <div class="grid two">
      <div class="card">
        <h2>Appearance</h2>
        <label>Theme</label>
        <select id="set_theme" class="input">
          <option value="dark" ${settings.theme==="dark"?"selected":""}>Dark (default)</option>
          <option value="light" ${settings.theme==="light"?"selected":""}>Light</option>
        </select>
        <hr/>
        <h2>Business</h2>
        <label>Company name</label>
        <input id="set_company" class="input" value="${escapeHtml(settings.companyName||"")}" />
        <label>Default labour rate (NZD/hr)</label>
        <input id="set_rate" class="input" type="number" step="0.01" value="${escapeHtml(String(settings.labourRate||""))}" />
        <div class="smallmuted">Logo is loaded from the root file: <strong>./logo.png</strong></div>
        <hr/>
        <button class="btn primary" id="saveSettings" type="button">Save settings</button>
      </div>
      <div class="card">
        <h2>Data</h2>
        <div class="sub">
          This app stores everything locally on your device (localStorage).<br/>
          Use Export/Import in the header for backups or moving phones.
        </div>
        <hr/>
        <button class="btn danger" id="wipeBtn" type="button">Wipe all data</button>
      </div>
    </div>
  `;
  $("#saveSettings").onclick = ()=>{
    settings.theme = $("#set_theme").value;
    settings.companyName = $("#set_company").value.trim() || "Matty Campbell Building";
    settings.labourRate = Number($("#set_rate").value || 0);
    saveSettings(settings);
    applyTheme();
    alert("Saved.");
  };
  $("#wipeBtn").onclick = ()=>{
    if(confirm("Wipe ALL app data? This can't be undone.")){
      state = defaults();
      saveState(state);
      alert("Wiped.");
      navTo("projects");
    }
  };
}

// ----------------- Demo data -----------------
function loadDemo(){
  if(state.projects.length) {
    if(!confirm("Load demo data (this will add demo records). Continue?")) return;
  }
  const pid = uid();
  state.projects.unshift({
    id: pid,
    name: "14 Kowhai Road Renovation",
    address: "14 Kowhai Road, Auckland, New Zealand",
    clientName: "Client Example",
    clientPhone: "0210000000",
    notes: "Gate code 1234. Watch the dog. Power in garage.",
    lat: -36.8485,
    lng: 174.7633,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  const sid = uid();
  state.subbies.unshift({ id:sid, name:"Sparkies Ltd", trade:"Electrician", phone:"0211111111", email:"spark@example.com", notes:"Prefers Fridays", createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
  state.tasks.unshift({ id:uid(), projectId:pid, title:"Book pre-line inspection", details:"Call council", status:"To do", dueDate:new Date(Date.now()+3*86400000).toISOString().slice(0,10), assignedSubbieId:null, photos:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
  state.diary.unshift({ id:uid(), projectId:pid, date:new Date().toISOString().slice(0,10), summary:"Framing progress in lounge + checked bracing fixings.", hours:"7.5", billable:true, category:"Labour", rate:"", photos:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
  state.variations.unshift({ id:uid(), projectId:pid, date:new Date().toISOString().slice(0,10), title:"Extra LVL beam", description:"Client requested opening widening; requires LVL + extra labour.", amount:"480", status:"Sent", photos:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
  state.deliveries.unshift({ id:uid(), projectId:pid, supplier:"PlaceMakers", date:new Date().toISOString().slice(0,10), status:"Expected", items:"Timber pack + fixings", dropPoint:"Driveway", notes:"Call ahead", photos:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
  state.inspections.unshift({ id:uid(), projectId:pid, type:"Pre-line", date:new Date(Date.now()+2*86400000).toISOString().slice(0,10), result:"Booked", inspector:"", notes:"Ensure smoke alarms locations confirmed", photos:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
  saveState(state);
  render();
}
