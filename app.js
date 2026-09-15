import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const COLS = [
  'ID','Ambito','Descrizione attività','Riferimenti attività','Stato','Priorità',
  'Owner ARPA','Owner BIP','Data apertura','Data chiusura','Scadenza','Note aggiuntive / Storico'
];
const INTERNAL_KEYS = new Set(['row_id','created_at','updated_at','created_by','updated_by']);
const STATUS_COLORS = {
  'Da iniziare':'#d97706','In corso':'#2563eb','In attesa':'#7c3aed','Bloccata':'#dc2626','Terminata':'#16a34a'
};
const cfg = window.ARPA_TRACKER_CONFIG || {};
const configOk = /^https:\/\/.+\.supabase\.co$/i.test(cfg.SUPABASE_URL || '') && /^sb_publishable_/i.test(cfg.SUPABASE_PUBLISHABLE_KEY || '');
let sb = null;
let session = null;
let profile = null;
let rows = [];
let filtered = [];
let editingRow = null;
let realtimeChannel = null;
let realtimeTimer = null;

const $ = (id) => document.getElementById(id);
const esc = (v='') => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const slug = (v='') => String(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const isAdmin = () => profile?.role === 'admin';
const isEditor = () => ['editor','admin'].includes(profile?.role);
const isClosed = (r) => String(r['Stato'] || '').toLowerCase() === 'terminata';

function toast(message, type='success') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 3200);
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) { button.dataset.label = button.textContent; button.textContent = label || 'Attendi…'; button.disabled = true; }
  else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; }
}

function parseDate(v) {
  if (!v || /^n\/?a$/i.test(String(v).trim()) || /^na$/i.test(String(v).trim())) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2])-1, Number(m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dueClass(r) {
  if (isClosed(r)) return '';
  const d = parseDate(r['Scadenza']); if (!d) return '';
  const today = new Date(); today.setHours(0,0,0,0); d.setHours(0,0,0,0);
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0) return 'overdue';
  if (diff <= 7) return 'due-soon';
  return '';
}

function normalizeValue(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function rowSearchText(r) {
  return COLS.map(c => normalizeValue(r[c])).join(' ').toLowerCase();
}

function initConfigGuard() {
  if (configOk) return true;
  $('setupBanner').classList.remove('hidden');
  $('loginError').textContent = 'Prima configura config.js con Project URL e Publishable Key di Supabase.';
  [...$('loginForm').elements].forEach(x => x.disabled = true);
  return false;
}

async function init() {
  if (!initConfigGuard()) return;
  sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  wireEvents();
  const { data, error } = await sb.auth.getSession();
  if (error) console.error(error);
  session = data?.session || null;
  if (session) await enterApp(); else showLogin();

  sb.auth.onAuthStateChange(async (_event, newSession) => {
    session = newSession;
    if (session) await enterApp(); else showLogin();
  });
}

function wireEvents() {
  $('loginForm').addEventListener('submit', login);
  $('logoutBtn').addEventListener('click', () => sb.auth.signOut());
  $('refreshBtn').addEventListener('click', loadActivities);
  $('addBtn').addEventListener('click', () => openActivityDialog(null));
  $('exportBtn').addEventListener('click', exportCSV);
  $('csvInput').addEventListener('change', importCSV);
  $('activityForm').addEventListener('submit', saveActivity);
  $('deleteActivityBtn').addEventListener('click', deleteActivity);
  $('manageUsersBtn').addEventListener('click', openUsers);
  $('changePasswordBtn').addEventListener('click', () => { $('passwordError').textContent=''; $('newPassword').value=''; $('confirmPassword').value=''; $('passwordDialog').showModal(); });
  $('passwordForm').addEventListener('submit', changePassword);
  ['search','statusFilter','priorityFilter','ambitoFilter','ownerFilter'].forEach(id => $(id).addEventListener(id === 'search' ? 'input' : 'change', applyFilters));
  $('clearFilters').addEventListener('click', () => { ['search','statusFilter','priorityFilter','ambitoFilter','ownerFilter'].forEach(id => $(id).value=''); applyFilters(); });
  document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => $(btn.dataset.close).close()));
}

async function login(e) {
  e.preventDefault();
  $('loginError').textContent = '';
  const btn = e.submitter;
  setBusy(btn, true, 'Accesso…');
  const { error } = await sb.auth.signInWithPassword({ email: $('loginEmail').value.trim(), password: $('loginPassword').value });
  setBusy(btn, false);
  if (error) $('loginError').textContent = 'Accesso non riuscito. Verifica email e password.';
}

function showLogin() {
  $('appView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
  profile = null; rows = []; filtered = [];
  if (realtimeChannel && sb) { sb.removeChannel(realtimeChannel); realtimeChannel = null; }
}

async function enterApp() {
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  try {
    await loadProfile();
    applyRoleUI();
    await loadActivities();
    subscribeRealtime();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Errore di caricamento', 'error');
  }
}

async function loadProfile() {
  const uid = session?.user?.id;
  const { data, error } = await sb.from('profiles').select('user_id,email,display_name,role').eq('user_id', uid).single();
  if (error) throw new Error('Profilo utente non disponibile. Verifica di aver eseguito lo script SQL di configurazione.');
  profile = data;
}

function applyRoleUI() {
  const roleLabel = {viewer:'Viewer',editor:'Editor',admin:'Admin'}[profile.role] || profile.role;
  $('userBadge').textContent = `${profile.display_name || profile.email} · ${roleLabel}`;
  $('addBtn').classList.toggle('hidden', !isEditor());
  $('manageUsersBtn').classList.toggle('hidden', !isAdmin());
  $('importLabel').classList.toggle('hidden', !isAdmin());
  $('roleHelp').textContent = isAdmin() ? 'Admin: modifica, elimina, importa e gestisce i ruoli' : isEditor() ? 'Editor: inserisce e modifica attività' : 'Viewer: sola consultazione';
}

async function loadActivities() {
  const btn = $('refreshBtn'); setBusy(btn, true, '↻ Aggiorno…');
  const { data, error } = await sb.from('activities').select('*').order('ID', { ascending: true });
  setBusy(btn, false);
  if (error) { toast('Impossibile caricare le attività: ' + error.message, 'error'); return; }
  rows = data || [];
  $('lastUpdated').textContent = 'Aggiornato ' + new Date().toLocaleString('it-IT');
  refreshAll();
}

function subscribeRealtime() {
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel = sb.channel('arpa-activities-live')
    .on('postgres_changes', { event:'*', schema:'public', table:'activities' }, () => {
      clearTimeout(realtimeTimer);
      realtimeTimer = setTimeout(loadActivities, 250);
    })
    .subscribe((status) => {
      $('liveBadge').textContent = status === 'SUBSCRIBED' ? '● Live' : '○ Connessione';
    });
}

function refreshAll() {
  populateFilters();
  applyFilters();
  renderKpis();
  renderCharts();
}

function populateFilters() {
  const sets = {status:new Set(),priority:new Set(),ambito:new Set(),owner:new Set()};
  rows.forEach(r => {
    if (r['Stato']) sets.status.add(r['Stato']);
    if (r['Priorità']) sets.priority.add(r['Priorità']);
    if (r['Ambito']) sets.ambito.add(r['Ambito']);
    [r['Owner ARPA'], r['Owner BIP']].filter(Boolean).forEach(x => sets.owner.add(x));
  });
  setOptions('statusFilter', sets.status); setOptions('priorityFilter', sets.priority); setOptions('ambitoFilter', sets.ambito); setOptions('ownerFilter', sets.owner);
}

function setOptions(id, values) {
  const el = $(id); const current = el.value; const first = el.options[0].outerHTML;
  const arr = [...values].sort((a,b) => String(a).localeCompare(String(b),'it'));
  el.innerHTML = first + arr.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if (arr.includes(current)) el.value = current;
}

function applyFilters() {
  const q = $('search').value.trim().toLowerCase();
  const sf = $('statusFilter').value, pf = $('priorityFilter').value, af = $('ambitoFilter').value, of = $('ownerFilter').value;
  filtered = rows.filter(r => (!q || rowSearchText(r).includes(q)) && (!sf || r['Stato']===sf) && (!pf || r['Priorità']===pf) && (!af || r['Ambito']===af) && (!of || r['Owner ARPA']===of || r['Owner BIP']===of));
  renderTable();
}

function renderKpis() {
  const total = rows.length;
  const todo = rows.filter(r => String(r['Stato']).toLowerCase()==='da iniziare').length;
  const doing = rows.filter(r => String(r['Stato']).toLowerCase()==='in corso').length;
  const high = rows.filter(r => !isClosed(r) && String(r['Priorità']).toLowerCase()==='alta').length;
  const overdue = rows.filter(r => dueClass(r)==='overdue').length;
  const done = rows.filter(isClosed).length;
  const pct = total ? Math.round(done/total*100) : 0;
  $('kpiTotal').textContent=total; $('kpiTodo').textContent=todo; $('kpiDoing').textContent=doing; $('kpiHigh').textContent=high; $('kpiOverdue').textContent=overdue; $('kpiProgress').textContent=pct+'%'; $('progressBar').style.width=pct+'%';
}

function renderCharts() {
  const counts={}; rows.forEach(r => { const s=r['Stato']||'Non indicato'; counts[s]=(counts[s]||0)+1; });
  const total=rows.length||1; let acc=0; const parts=[];
  Object.entries(counts).forEach(([s,n]) => { const start=acc/total*360; acc+=n; const end=acc/total*360; parts.push(`${STATUS_COLORS[s]||'#98a2b3'} ${start}deg ${end}deg`); });
  $('statusDonut').style.background=`conic-gradient(${parts.join(',')||'#eef2f6 0 360deg'})`;
  $('donePct').textContent=Math.round(rows.filter(isClosed).length/total*100)+'%';
  $('statusLegend').innerHTML=Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([s,n])=>`<div class="legend-row"><span class="dot" style="background:${STATUS_COLORS[s]||'#98a2b3'}"></span><span>${esc(s)}</span><strong>${n}</strong></div>`).join('');
  const amb={}; rows.forEach(r => { const a=r['Ambito']||'Non indicato'; amb[a]=(amb[a]||0)+1; }); const max=Math.max(1,...Object.values(amb));
  $('ambitoBars').innerHTML=Object.entries(amb).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([a,n])=>`<div class="bar-row"><div class="bar-label" title="${esc(a)}">${esc(a)}</div><div class="bar-bg"><div class="bar" style="width:${n/max*100}%"></div></div><strong>${n}</strong></div>`).join('');
}

function renderTable() {
  const actions = '<th>Azioni</th>';
  $('thead').innerHTML = COLS.map(c => `<th>${esc(c)}</th>`).join('') + actions;
  const priorityRank={Alta:0,Media:1,Bassa:2};
  const ordered=[...filtered].sort((a,b)=>(priorityRank[a['Priorità']]??9)-(priorityRank[b['Priorità']]??9)||(parseDate(a['Scadenza'])?.getTime()??9e15)-(parseDate(b['Scadenza'])?.getTime()??9e15)||(Number(a['ID'])||0)-(Number(b['ID'])||0));
  $('rowsCount').textContent = `${ordered.length} ${ordered.length===1?'attività':'attività'}`;
  $('tbody').innerHTML = ordered.map(r => {
    const buttons = [
      `<button class="icon-btn" data-history="${esc(r.row_id)}" title="Storico">◴</button>`,
      isEditor() ? `<button class="icon-btn" data-edit="${esc(r.row_id)}" title="Modifica">✎</button>` : ''
    ].join('');
    return `<tr>
      <td class="id">${esc(r['ID'])}</td>
      <td>${esc(r['Ambito'])}</td>
      <td class="desc">${esc(r['Descrizione attività'])}</td>
      <td>${esc(r['Riferimenti attività'])}</td>
      <td><span class="badge s-${slug(r['Stato'])}">${esc(r['Stato'])}</span></td>
      <td><span class="badge p-${slug(r['Priorità'])}">${esc(r['Priorità'])}</span></td>
      <td>${esc(r['Owner ARPA'])}</td><td>${esc(r['Owner BIP'])}</td>
      <td>${esc(r['Data apertura'])}</td><td>${esc(r['Data chiusura'])}</td>
      <td class="${dueClass(r)}">${esc(r['Scadenza'])}</td>
      <td class="notes">${esc(r['Note aggiuntive / Storico'])}</td>
      <td><div class="row-actions">${buttons}</div></td>
    </tr>`;
  }).join('');
  $('empty').classList.toggle('hidden', ordered.length !== 0);
  document.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => openActivityDialog(rows.find(r => r.row_id===btn.dataset.edit))));
  document.querySelectorAll('[data-history]').forEach(btn => btn.addEventListener('click', () => openHistory(rows.find(r => r.row_id===btn.dataset.history))));
}

function fieldHtml(col, value, isNew) {
  const val = normalizeValue(value);
  const span = ['Descrizione attività','Note aggiuntive / Storico'].includes(col) ? 'span2' : '';
  if (col === 'ID') return `<label>${esc(col)}<input class="field" name="${esc(col)}" value="${esc(val)}" placeholder="Automatico" readonly /></label>`;
  if (col === 'Stato') {
    const opts=['','Da iniziare','In corso','In attesa','Bloccata','Terminata'];
    return `<label>${esc(col)}<select class="field" name="${esc(col)}">${opts.map(o=>`<option value="${esc(o)}" ${o===val?'selected':''}>${esc(o)}</option>`).join('')}</select></label>`;
  }
  if (col === 'Priorità') {
    const opts=['','Alta','Media','Bassa'];
    return `<label>${esc(col)}<select class="field" name="${esc(col)}">${opts.map(o=>`<option value="${esc(o)}" ${o===val?'selected':''}>${esc(o)}</option>`).join('')}</select></label>`;
  }
  if (col === 'Note aggiuntive / Storico') return `<label class="${span}">${esc(col)}<textarea class="field" rows="5" name="${esc(col)}">${esc(val)}</textarea></label>`;
  const placeholder = ['Data apertura','Data chiusura','Scadenza'].includes(col) ? 'gg/mm/aaaa' : '';
  return `<label class="${span}">${esc(col)}<input class="field" name="${esc(col)}" value="${esc(val)}" placeholder="${placeholder}" ${col==='Descrizione attività'?'required':''}/></label>`;
}

function openActivityDialog(row) {
  if (!isEditor()) return;
  editingRow = row || null;
  $('activityModalTitle').textContent = row ? `Modifica attività #${row['ID']}` : 'Nuova attività';
  $('activityModalSub').textContent = row ? `Ultimo aggiornamento: ${row.updated_at ? new Date(row.updated_at).toLocaleString('it-IT') : '—'}` : 'L’ID sarà assegnato automaticamente dal database.';
  const defaults = row || {'Stato':'Da iniziare','Priorità':'Media'};
  $('activityFields').innerHTML = COLS.map(c => fieldHtml(c, defaults[c], !row)).join('');
  $('deleteActivityBtn').classList.toggle('hidden', !row || !isAdmin());
  $('activityDialog').showModal();
}

async function saveActivity(e) {
  e.preventDefault();
  if (!isEditor()) return;
  const submit = e.submitter; setBusy(submit,true,'Salvo…');
  const fd = new FormData(e.target); const payload={};
  COLS.forEach(c => { const v=normalizeValue(fd.get(c)); if (c==='ID') { if (v) payload[c]=Number(v); } else payload[c]=v || null; });
  let result;
  if (editingRow) result = await sb.from('activities').update(payload).eq('row_id', editingRow.row_id).select().single();
  else result = await sb.from('activities').insert(payload).select().single();
  setBusy(submit,false);
  if (result.error) { toast('Salvataggio non riuscito: '+result.error.message,'error'); return; }
  $('activityDialog').close(); toast('Attività salvata.'); await loadActivities();
}

async function deleteActivity() {
  if (!editingRow || !isAdmin()) return;
  if (!confirm(`Eliminare definitivamente l'attività #${editingRow['ID']}? Lo storico rimarrà nell'audit log.`)) return;
  const btn=$('deleteActivityBtn'); setBusy(btn,true,'Elimino…');
  const { error } = await sb.from('activities').delete().eq('row_id', editingRow.row_id);
  setBusy(btn,false);
  if (error) { toast('Eliminazione non riuscita: '+error.message,'error'); return; }
  $('activityDialog').close(); toast('Attività eliminata.'); await loadActivities();
}

async function openHistory(row) {
  if (!row) return;
  $('historyTitle').textContent = `#${row['ID']} · ${row['Descrizione attività'] || ''}`;
  $('historyBody').innerHTML = '<div class="muted">Caricamento…</div>';
  $('historyDialog').showModal();
  const { data, error } = await sb.from('audit_log').select('*').eq('activity_row_id', row.row_id).order('changed_at',{ascending:false}).limit(100);
  if (error) { $('historyBody').innerHTML=`<div class="form-error">${esc(error.message)}</div>`; return; }
  if (!data?.length) { $('historyBody').innerHTML='<div class="muted">Nessuna modifica registrata.</div>'; return; }
  $('historyBody').innerHTML = data.map(renderHistoryItem).join('');
}

function renderHistoryItem(item) {
  const actionLabel = {INSERT:'Creazione',UPDATE:'Modifica',DELETE:'Eliminazione'}[item.action] || item.action;
  const before=item.old_data||{}, after=item.new_data||{}; const changes=[];
  if (item.action==='UPDATE') {
    COLS.forEach(c => { if (normalizeValue(before[c]) !== normalizeValue(after[c])) changes.push(`<div class="change-line"><strong>${esc(c)}</strong><div><span class="old">${esc(before[c]||'—')}</span> → <span class="new">${esc(after[c]||'—')}</span></div></div>`); });
  } else if (item.action==='INSERT') {
    changes.push('<div class="change-line"><strong>Stato iniziale</strong><div>Attività creata</div></div>');
  } else if (item.action==='DELETE') {
    changes.push('<div class="change-line"><strong>Esito</strong><div>Attività eliminata</div></div>');
  }
  return `<div class="history-item"><div class="history-meta"><span class="history-action">${esc(actionLabel)}</span><span class="muted">${esc(item.changed_by_email||'Sistema')} · ${new Date(item.changed_at).toLocaleString('it-IT')}</span></div><div class="history-changes">${changes.join('')||'<span class="muted">Nessuna variazione sui campi operativi.</span>'}</div></div>`;
}

async function openUsers() {
  if (!isAdmin()) return;
  $('usersList').innerHTML='<div class="muted">Caricamento…</div>'; $('usersDialog').showModal();
  const { data,error }=await sb.from('profiles').select('user_id,email,display_name,role,created_at').order('email');
  if(error){$('usersList').innerHTML=`<div class="form-error">${esc(error.message)}</div>`;return;}
  $('usersList').innerHTML=(data||[]).map(u=>`<div class="user-row"><div><div class="user-email">${esc(u.email)}</div><div class="user-name">${esc(u.display_name||'')} ${u.user_id===session.user.id?'· Tu':''}</div></div><select class="field" data-role-user="${esc(u.user_id)}" ${u.user_id===session.user.id?'disabled':''}><option value="viewer" ${u.role==='viewer'?'selected':''}>Viewer</option><option value="editor" ${u.role==='editor'?'selected':''}>Editor</option><option value="admin" ${u.role==='admin'?'selected':''}>Admin</option></select><span class="badge s-${u.role==='admin'?'terminata':u.role==='editor'?'in-corso':'in-attesa'}">${esc(u.role)}</span></div>`).join('');
  document.querySelectorAll('[data-role-user]').forEach(sel=>sel.addEventListener('change',()=>changeRole(sel.dataset.roleUser,sel.value,sel)));
}

async function changeRole(userId, role, selectEl) {
  const previous=[...selectEl.options].find(o=>o.defaultSelected)?.value;
  selectEl.disabled=true;
  const { error }=await sb.rpc('set_user_role',{target_user_id:userId,new_role:role});
  selectEl.disabled=false;
  if(error){toast('Ruolo non aggiornato: '+error.message,'error'); await openUsers(); return;}
  toast('Ruolo aggiornato.'); await openUsers();
}

async function changePassword(e) {
  e.preventDefault(); $('passwordError').textContent='';
  const p1=$('newPassword').value,p2=$('confirmPassword').value;
  if(p1!==p2){$('passwordError').textContent='Le password non coincidono.';return;}
  const btn=e.submitter;setBusy(btn,true,'Aggiorno…');
  const { error }=await sb.auth.updateUser({password:p1}); setBusy(btn,false);
  if(error){$('passwordError').textContent=error.message;return;}
  $('passwordDialog').close();toast('Password aggiornata.');
}

function csvDelimiter(text) {
  const line=(text.replace(/^\uFEFF/,'').split(/\r?\n/).find(x=>x.trim())||'');
  const commas=(line.match(/,/g)||[]).length, semis=(line.match(/;/g)||[]).length;
  return semis>commas?';':',';
}

function parseCSV(text) {
  text=text.replace(/^\uFEFF/,''); const delim=csvDelimiter(text); const out=[]; let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){ if(ch==='"' && text[i+1]==='"'){field+='"';i++;} else if(ch==='"')quoted=false; else field+=ch; }
    else { if(ch==='"')quoted=true; else if(ch===delim){row.push(field);field='';} else if(ch==='\n'){row.push(field.replace(/\r$/,''));out.push(row);row=[];field='';} else field+=ch; }
  }
  if(field.length||row.length){row.push(field.replace(/\r$/,''));out.push(row);}
  if(!out.length)return[];
  const headers=out.shift().map(h=>h.trim().replace(/^\uFEFF/,''));
  return out.filter(r=>r.some(x=>String(x).trim())).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
}

function normalizeImportedRow(raw) {
  const byTrim={}; Object.entries(raw).forEach(([k,v])=>byTrim[k.trim()]=v);
  const obj={}; COLS.forEach(c=>obj[c]=normalizeValue(byTrim[c]));
  if(obj['ID']) obj['ID']=Number(obj['ID']); else delete obj['ID'];
  Object.keys(obj).forEach(k=>{if(k!=='ID' && obj[k]==='')obj[k]=null;});
  return obj;
}

async function importCSV(e) {
  const file=e.target.files?.[0]; e.target.value=''; if(!file||!isAdmin())return;
  const text=await file.text(); const parsed=parseCSV(text).map(normalizeImportedRow);
  if(!parsed.length){toast('Il CSV non contiene righe importabili.','error');return;}
  const required=['Ambito','Descrizione attività','Stato'];
  if(!confirm(`Importare ${parsed.length} attività? Le righe con lo stesso ID verranno aggiornate; le altre verranno aggiunte.`))return;
  const withId=parsed.filter(r=>Number.isFinite(r['ID'])); const withoutId=parsed.filter(r=>!Number.isFinite(r['ID']));
  const batch=async(arr,mode)=>{for(let i=0;i<arr.length;i+=200){const chunk=arr.slice(i,i+200);const res=mode==='upsert'?await sb.from('activities').upsert(chunk,{onConflict:'ID'}):await sb.from('activities').insert(chunk);if(res.error)throw res.error;}};
  try{
    await batch(withId,'upsert'); await batch(withoutId,'insert');
    const sync=await sb.rpc('sync_activity_id_sequence'); if(sync.error)console.warn(sync.error);
    toast(`Import completato: ${parsed.length} attività.`); await loadActivities();
  }catch(err){toast('Import non riuscito: '+err.message,'error');}
}

function toCSV(data) {
  const q=v=>{const s=normalizeValue(v);return /[",;\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
  return '\uFEFF'+[COLS.map(q).join(','),...data.sort((a,b)=>(Number(a['ID'])||0)-(Number(b['ID'])||0)).map(r=>COLS.map(c=>q(r[c])).join(','))].join('\r\n');
}

function exportCSV() {
  const blob=new Blob([toCSV([...rows])],{type:'text/csv;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url;a.download=`TODO_${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}

init();
