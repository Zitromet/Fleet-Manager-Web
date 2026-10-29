// =====================================================================
// app.js - the "glue" of the dashboard page:
//   1. makes sure you are signed in, then loads the data (data.js)
//   2. draws the screens (views.js -> renderAll)
//   3. every add / edit / delete: save to Supabase, then reload and redraw
// Reloading after each save keeps things simple and also picks up any
// changes your bots made in the meantime.
// =====================================================================

// ---------- small helpers ----------
const todayStr = () => todayLocal();   // defined in views.js
const findVehicle = id => DB.vehicles.find(v => v.id === id);

// Make text safe to put inside HTML (stops odd characters breaking the page)
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function setStatus(text) {
  document.getElementById("syncStatusText").textContent = text;
}

// Run a save, show errors in plain words, then reload everything.
async function saveThenReload(saveFn) {
  setStatus("Saving…");
  try {
    await saveFn();
    await touchLastUpdated();
    await reloadFromCloud();
  } catch (err) {
    alert("Not saved: " + err.message);
    setStatus("⚠ Last save failed — " + err.message);
  }
}

// ---------- 1. start-up ----------
(async function boot() {
  if (CONFIG_IS_PLACEHOLDER) { location.href = "index.html"; return; }
  const { data } = await sb.auth.getSession();
  if (!data.session) { location.href = "index.html"; return; }
  document.getElementById("signOutBtn").title = "Signed in as " + data.session.user.email;
  await reloadFromCloud();
  document.getElementById("loadingScreen").remove();

  // When you come back to this tab (e.g. phone unlocked), get fresh data.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reloadFromCloud();
  });
})();

async function reloadFromCloud() {
  try {
    DB = await loadFleetData();
  } catch (err) {
    setStatus("⚠ Could not load data: " + err.message);
    if (/JWT|session|auth/i.test(err.message)) location.href = "index.html";
    return;
  }
  if (currentVehicle !== "all" && !findVehicle(currentVehicle)) currentVehicle = "all";
  fillVehiclePickers();
  renderAll();
  setStatus(`☁️ Cloud data • ${DB.vehicles.length} vehicles • ${DB.serviceLog.length} service records • loaded ${new Date().toLocaleTimeString()}`);
}

async function signOut() {
  await sb.auth.signOut();
  location.href = "index.html";
}

// Mobile bottom bar + "Vehicle" list in the Log Service form
function fillVehiclePickers() {
  const icons = ["🚗", "🚙", "⚡", "🚐", "🛻", "🏍"];
  document.getElementById("mobileNav").innerHTML =
    `<button class="m-nav-btn" onclick="setVehicle('all')"><span>🚘</span><span>All</span></button>` +
    DB.vehicles.map((v, i) =>
      `<button class="m-nav-btn" onclick="setVehicle('${esc(v.id)}')"><span>${icons[i % icons.length]}</span><span>${esc(v.name.replace(/^20(\d\d)/, "$1"))}</span></button>`
    ).join("");
  document.getElementById("logVehicle").innerHTML =
    DB.vehicles.map(v => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join("");
}

// ---------- 2. edits that the old dashboard screens already call ----------

// Typing a new odometer reading on the dashboard
function updateOdometer(vehId, val) {
  const miles = parseInt(String(val).replace(/,/g, ""), 10);
  if (isNaN(miles) || miles < 0) return alert("Please type a number of miles.");
  saveThenReload(() => dbUpdateMileage(vehId, miles, todayStr()));
}

// "+ Log Service" form
function submitNewLog(e) {
  e.preventDefault();
  const val = id => document.getElementById(id).value;
  const entry = {
    date: val("logDate"),
    vehicle: val("logVehicle"),
    odometer: parseInt(val("logOdo"), 10) || 0,
    item: val("logItem"),
    cost: parseFloat(val("logCost")) || 0,
    doneBy: val("logDoneBy"),
    shop: val("logShop"),
    invoice: val("logInv"),
    details: val("logDetails"),
    notes: "Logged via Fleet Website",
  };
  closeLogModal();
  saveThenReload(async () => {
    await dbSaveLog(entry);
    await raiseMileageIfHigher(entry.vehicle, entry.odometer, entry.date);
  });
}

// If a service was done at more miles than we have on record, update the car.
async function raiseMileageIfHigher(vehicleName, odometer, dateStr) {
  const v = DB.vehicles.find(x => x.name === vehicleName);
  if (v && odometer > (v.currentMileage || 0)) await dbUpdateMileage(v.id, odometer, dateStr);
}

// ---------- 3. one pop-up form used for every edit ----------
// fields: [{ key, label, value, type: 'text'|'number'|'date'|'select'|'textarea', options: [...] }]
function openForm(title, fields, onSave) {
  closeForm();
  const box = document.createElement("div");
  box.id = "editModal";
  box.className = "modal-backdrop";
  box.innerHTML = `
    <div class="card modal-card">
      <div class="card-hdr">
        <div class="card-title">${esc(title)}</div>
        <button class="btn" type="button" onclick="closeForm()">✕</button>
      </div>
      <form id="editForm" class="edit-grid">
        ${fields.map(fieldHtml).join("")}
        <div class="edit-actions">
          <button type="button" class="btn" onclick="closeForm()">Cancel</button>
          <button type="submit" class="btn btn-primary">💾 Save</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(box);
  document.getElementById("editForm").onsubmit = (ev) => {
    ev.preventDefault();
    const out = {};
    for (const f of fields) {
      if (f.readonly) continue;
      // namedItem(): plain elements[key] breaks for a field called "item"
      const raw = ev.target.elements.namedItem(f.key).value.trim();
      out[f.key] = f.type === "number" ? (raw === "" ? null : Number(raw)) : (raw === "" && f.type === "date" ? null : raw);
    }
    closeForm();
    onSave(out);
  };
}
function closeForm() {
  const m = document.getElementById("editModal");
  if (m) m.remove();
}
function fieldHtml(f) {
  const wide = f.type === "textarea" ? " wide" : "";
  let input;
  if (f.type === "select") {
    input = `<select name="${f.key}">${f.options.map(o =>
      `<option value="${esc(o)}" ${String(o) === String(f.value ?? "") ? "selected" : ""}>${esc(o === "" ? "(none)" : o)}</option>`).join("")}</select>`;
  } else if (f.type === "textarea") {
    input = `<textarea name="${f.key}" rows="3">${esc(f.value)}</textarea>`;
  } else {
    input = `<input name="${f.key}" type="${f.type || "text"}" ${f.type === "number" ? 'step="any"' : ""}
      value="${esc(f.value)}" ${f.required ? "required" : ""} ${f.readonly ? "readonly" : ""} />`;
  }
  return `<label class="form-field${wide}"><span>${esc(f.label)}</span>${input}</label>`;
}

// Pick a field type from the field name/value (date-looking names get a date picker)
function guessType(key, value) {
  if (typeof value === "number") return "number";
  if (/date|expires|renewed/i.test(key)) return "date";
  if (typeof value === "string" && value.length > 60) return "textarea";
  return "text";
}

// ---------- 4. vehicles ----------
const VEHICLE_FIELDS = [
  ["name", "Name (used in service log)"], ["shortLabel", "Short label"], ["fullName", "Full name"],
  ["vin", "VIN"], ["plate", "Plate"], ["state", "State"], ["currentMileage", "Current mileage"],
  ["mileageUpdatedDate", "Mileage updated"], ["manufactured", "Manufactured"], ["engine", "Engine"],
  ["transmission", "Transmission"], ["drivetrain", "Drivetrain"], ["gvwr", "GVWR"],
  ["oilSpec", "Oil spec"], ["oilNote", "Oil note"], ["badgeColor", "Badge color (#hex)"],
  ["sortOrder", "Order in list (1, 2, 3…)"],
];

function editVehicle(id) {
  const isNew = !id;
  // A new car starts with the same tire/DMV fields as the first car (empty values)
  const template = DB.vehicles[0] || { tires: {}, dmv: {} };
  const v = isNew
    ? { id: "", sortOrder: DB.vehicles.length + 1, badgeColor: "#64748b", state: "NY",
        tires: blankCopy(template.tires), dmv: blankCopy(template.dmv) }
    : findVehicle(id);

  const fields = [{ key: "id", label: "Short id (lowercase, no spaces, cannot change later)",
                    value: v.id, required: true, readonly: !isNew }]
    .concat(VEHICLE_FIELDS.map(([k, label]) => ({
      key: k, label, value: v[k] ?? "", required: k === "name",
      type: k === "currentMileage" || k === "sortOrder" ? "number" : guessType(k, v[k]) })))
    .concat(Object.keys(v.tires || {}).map(k => ({
      key: "tires." + k, label: "Tires: " + k, value: v.tires[k], type: guessType(k, template.tires[k] ?? v.tires[k]) })))
    .concat(Object.keys(v.dmv || {}).map(k => ({
      key: "dmv." + k, label: "DMV: " + k, value: v.dmv[k], type: guessType(k, template.dmv[k] ?? v.dmv[k]) })));

  openForm(isNew ? "Add Vehicle" : `Edit Vehicle, Tires & DMV — ${v.name}`, fields, (out) => {
    const updated = Object.assign({}, v, { tires: Object.assign({}, v.tires), dmv: Object.assign({}, v.dmv) });
    for (const [k, val] of Object.entries(out)) {
      if (k.startsWith("tires.")) updated.tires[k.slice(6)] = val;
      else if (k.startsWith("dmv.")) updated.dmv[k.slice(4)] = val;
      else updated[k] = val;
    }
    if (isNew) {
      updated.id = String(updated.id).toLowerCase().replace(/[^a-z0-9_-]/g, "");
      if (!updated.id) return alert("Please give the vehicle a short id, e.g. 'civic'.");
      if (findVehicle(updated.id)) return alert("That id is already used.");
    }
    saveThenReload(() => dbSaveVehicle(updated, isNew));
  });
}

function blankCopy(obj) {
  const out = {};
  Object.keys(obj || {}).forEach(k => { out[k] = typeof obj[k] === "number" ? null : ""; });
  return out;
}

function deleteVehicle(id) {
  const v = findVehicle(id);
  const logs = DB.serviceLog.filter(l => l.vehicle === v.name).length;
  if (logs > 0) {
    return alert(`${v.name} still has ${logs} service log entries. Delete those first ` +
                 `(this protects your history from being lost by accident).`);
  }
  if (!confirm(`Delete ${v.name} and its ${v.items.length} schedule items? This cannot be undone.`)) return;
  saveThenReload(() => dbDeleteVehicle(id));
}

// ---------- 5. schedule (maintenance) items ----------
function editItem(vehicleId, itemId) {
  const v = findVehicle(vehicleId);
  const it = itemId ? v.items.find(i => i.id === itemId)
    : { category: "Maintenance", track: "Yes", row: Math.max(0, ...v.items.map(i => i.row || 0)) + 1 };
  openForm(itemId ? `Edit Schedule Item — ${v.name}` : `Add Schedule Item — ${v.name}`, [
    { key: "category", label: "Category", value: it.category },
    { key: "item", label: "Item (must match the service log name)", value: it.item, required: true },
    { key: "intervalMiles", label: "Every … miles", value: it.intervalMiles, type: "number" },
    { key: "intervalMonths", label: "Every … months", value: it.intervalMonths, type: "number" },
    { key: "track", label: "Track due status?", value: it.track, type: "select", options: ["Yes", "No"] },
    { key: "pkgLevel", label: "Also done by package (1 Minor, 2 Standard, 3 Extended)", value: it.pkgLevel ?? "",
      type: "select", options: ["", "1", "2", "3"] },
    { key: "row", label: "Order in list", value: it.row, type: "number" },
    { key: "note", label: "Note", value: it.note, type: "textarea" },
  ], (out) => {
    out.pkgLevel = out.pkgLevel === "" ? null : Number(out.pkgLevel);
    saveThenReload(() => dbSaveItem(vehicleId, Object.assign({ id: itemId || null }, out)));
  });
}

function deleteItem(vehicleId, itemId) {
  const it = findVehicle(vehicleId).items.find(i => i.id === itemId);
  if (!confirm(`Delete schedule item "${it.item}"?`)) return;
  saveThenReload(() => dbDeleteItem(itemId));
}

// "✓ Log Done" button: pre-filled service log entry for that item
function logDone(vehicleId, itemId) {
  const v = findVehicle(vehicleId);
  const it = v.items.find(i => i.id === itemId);
  editLog(null, { date: todayStr(), vehicle: v.name, odometer: v.currentMileage, item: it.item,
                  cost: 0, doneBy: "Independent shop", shop: "", details: "", invoice: "",
                  notes: "Quick-logged via ✓ Log Done" });
}

// ---------- 6. service log ----------
function editLog(logId, preset) {
  const l = logId ? DB.serviceLog.find(x => x.id === logId) : preset;
  const doneByOptions = ["Independent shop", "Dealer", "DIY"];
  if (l.doneBy && !doneByOptions.includes(l.doneBy)) doneByOptions.push(l.doneBy);
  openForm(logId ? "Edit Service Log Entry" : "✓ Log Service Done", [
    { key: "date", label: "Date", value: l.date, type: "date", required: true },
    { key: "vehicle", label: "Vehicle", value: l.vehicle, type: "select", options: DB.vehicles.map(v => v.name) },
    { key: "odometer", label: "Odometer (mi)", value: l.odometer, type: "number" },
    { key: "item", label: "Service item", value: l.item, required: true },
    { key: "cost", label: "Cost ($)", value: l.cost, type: "number" },
    { key: "doneBy", label: "Done by", value: l.doneBy, type: "select", options: doneByOptions },
    { key: "shop", label: "Shop / vendor", value: l.shop },
    { key: "invoice", label: "Invoice / RO #", value: l.invoice },
    { key: "details", label: "Details", value: l.details, type: "textarea" },
    { key: "notes", label: "Notes", value: l.notes, type: "textarea" },
  ], (out) => {
    saveThenReload(async () => {
      await dbSaveLog(Object.assign({ id: logId || null }, out));
      await raiseMileageIfHigher(out.vehicle, out.odometer, out.date);
    });
  });
}

function deleteLog(logId) {
  const l = DB.serviceLog.find(x => x.id === logId);
  if (!confirm(`Delete service entry "${l.item}" (${l.date}, ${l.vehicle})?`)) return;
  saveThenReload(() => dbDeleteLog(logId));
}

// ---------- 7. owner / insurance / alert thresholds ----------
function editInsurance() {
  const ins = DB.insurance;
  openForm("Edit Insurance", Object.keys(ins).map(k => ({
    key: k, label: k, value: ins[k], type: guessType(k, ins[k]) })),
    (out) => saveThenReload(() => dbSaveSetting("insurance", Object.assign({}, ins, out))));
}

function editOwner() {
  const o = DB.owner;
  const fields = [
    { key: "name", label: "Named insured", value: o.name },
    { key: "address", label: "Garaging address", value: o.address },
  ];
  (o.drivers || []).forEach((d, i) => {
    fields.push({ key: `d${i}name`, label: `Driver ${i + 1} name`, value: d.name });
    fields.push({ key: `d${i}role`, label: `Driver ${i + 1} role`, value: d.role });
  });
  fields.push({ key: "newName", label: "Add driver: name (optional)", value: "" });
  fields.push({ key: "newRole", label: "Add driver: role", value: "" });
  openForm("Edit Owner & Drivers", fields, (out) => {
    const drivers = (o.drivers || []).map((_, i) => ({ name: out[`d${i}name`], role: out[`d${i}role`] }))
      .filter(d => d.name);   // clear a name to remove that driver
    if (out.newName) drivers.push({ name: out.newName, role: out.newRole });
    saveThenReload(() => dbSaveSetting("owner", { name: out.name, address: out.address, drivers }));
  });
}

function editThresholds() {
  const t = DB.thresholds;
  openForm("Edit Alert Thresholds", [
    { key: "mSoon", label: "SOON when miles left ≤", value: t.miles.soon, type: "number" },
    { key: "mVery", label: "VERY SOON when miles left ≤", value: t.miles.verySoon, type: "number" },
    { key: "mHas", label: "HAS TO BE DONE when miles left ≤", value: t.miles.hasToBeDone, type: "number" },
    { key: "dSoon", label: "SOON when days left ≤", value: t.days.soon, type: "number" },
    { key: "dVery", label: "VERY SOON when days left ≤", value: t.days.verySoon, type: "number" },
    { key: "dHas", label: "HAS TO BE DONE when days left ≤", value: t.days.hasToBeDone, type: "number" },
  ], (o) => saveThenReload(() => dbSaveSetting("thresholds", Object.assign({}, t, {
    miles: Object.assign({}, t.miles, { soon: o.mSoon, verySoon: o.mVery, hasToBeDone: o.mHas }),
    days: Object.assign({}, t.days, { soon: o.dSoon, verySoon: o.dVery, hasToBeDone: o.dHas }),
  }))));
}

// ---------- 8. the "🛠 Manage Data" screen (called by renderAll in views.js) ----------
function renderManageView() {
  const vehs = DB.vehicles.filter(v => currentVehicle === "all" || v.id === currentVehicle);
  const btn = (text, onclick, cls = "") => `<button class="btn btn-sm ${cls}" onclick="${onclick}">${text}</button>`;

  let h = `<div class="card">
    <div class="card-hdr"><div class="card-title">🛠 Manage Fleet Data (saves to the cloud right away)</div></div>
    <div class="manage-row">
      ${btn("+ Add Vehicle", "editVehicle(null)", "btn-primary")}
      ${btn("✏ Owner & Drivers", "editOwner()")}
      ${btn("✏ Insurance", "editInsurance()")}
      ${btn("✏ Alert Thresholds", "editThresholds()")}
    </div></div>`;

  for (const v of vehs) {
    h += `<div class="card">
      <div class="card-hdr"><div class="card-title">${esc(v.name)}</div>
        <div class="manage-row">
          ${btn("✏ Vehicle, Tires & DMV", `editVehicle('${esc(v.id)}')`)}
          ${btn("+ Schedule Item", `editItem('${esc(v.id)}', null)`, "btn-primary")}
          ${btn("🗑 Delete Vehicle", `deleteVehicle('${esc(v.id)}')`, "btn-danger")}
        </div></div>
      <div class="table-scroll"><table class="manage-table">
        <thead><tr><th>Category</th><th>Item</th><th>Miles</th><th>Months</th><th>Track</th><th></th></tr></thead>
        <tbody>${v.items.map(it => `<tr>
          <td>${esc(it.category)}</td><td>${esc(it.item)}</td>
          <td class="num">${fmtNum(it.intervalMiles)}</td><td class="num">${it.intervalMonths ?? "—"}</td>
          <td>${esc(it.track)}</td>
          <td class="actions">${btn("✓ Log Done", `logDone('${esc(v.id)}', ${it.id})`, "btn-success")}
            ${btn("✏", `editItem('${esc(v.id)}', ${it.id})`)} ${btn("🗑", `deleteItem('${esc(v.id)}', ${it.id})`)}</td>
        </tr>`).join("")}</tbody></table></div></div>`;
  }

  const names = vehs.map(v => v.name);
  const logs = DB.serviceLog.filter(l => names.includes(l.vehicle))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  h += `<div class="card">
    <div class="card-hdr"><div class="card-title">📋 Service Log (${logs.length})</div>
      ${btn("+ Add Entry", "openLogModal()", "btn-primary")}</div>
    <div class="table-scroll"><table class="manage-table">
      <thead><tr><th>Date</th><th>Vehicle</th><th>Odometer</th><th>Item</th><th>Cost</th><th></th></tr></thead>
      <tbody>${logs.map(l => `<tr>
        <td>${esc(l.date)}</td><td>${esc(l.vehicle)}</td><td class="num">${fmtNum(l.odometer)}</td>
        <td>${esc(l.item)}</td><td class="num">${fmtMoney(l.cost)}</td>
        <td class="actions">${btn("✏ Edit", `editLog(${l.id})`)} ${btn("🗑", `deleteLog(${l.id})`)}</td>
      </tr>`).join("")}</tbody></table></div></div>`;
  return h;
}
