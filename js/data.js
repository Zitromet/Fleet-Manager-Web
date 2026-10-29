// =====================================================================
// data.js - everything that talks to the Supabase database.
//
// The database uses snake_case column names (current_mileage); the
// dashboard code uses the old app's camelCase names (currentMileage).
// The small "toX / fromX" functions below translate between the two,
// so views.js could stay exactly like the old dashboard.
// =====================================================================

// ---------- connect ----------
const CFG = window.FLEET_CONFIG || {};
const CONFIG_IS_PLACEHOLDER =
  !CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes("YOUR-PROJECT-ID") ||
  !CFG.SUPABASE_ANON_KEY || CFG.SUPABASE_ANON_KEY.includes("YOUR-ANON");

// "supabase" (lower case) is the library loaded from the CDN in the HTML page.
// "sb" is our connection to YOUR project.
const sb = CONFIG_IS_PLACEHOLDER
  ? null
  : supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

// Stop with a clear message if a database call failed.
function check(result, what) {
  if (result.error) {
    console.error(what, result.error);
    throw new Error(what + ": " + result.error.message);
  }
  return result.data;
}

// ---------- translate rows: database <-> dashboard ----------
function vehicleFromRow(r) {
  return {
    id: r.id, sortOrder: r.sort_order, name: r.name, fullName: r.full_name,
    shortLabel: r.short_label, badgeColor: r.badge_color, vin: r.vin,
    plate: r.plate, state: r.state, currentMileage: r.current_mileage,
    mileageUpdatedDate: r.mileage_updated_date, manufactured: r.manufactured,
    engine: r.engine, transmission: r.transmission, drivetrain: r.drivetrain,
    gvwr: r.gvwr, oilSpec: r.oil_spec, oilNote: r.oil_note,
    dmv: r.dmv || {}, tires: r.tires || {}, items: [],
  };
}
function vehicleToRow(v) {
  return {
    id: v.id, sort_order: v.sortOrder, name: v.name, full_name: v.fullName,
    short_label: v.shortLabel, badge_color: v.badgeColor, vin: v.vin,
    plate: v.plate, state: v.state, current_mileage: v.currentMileage,
    mileage_updated_date: v.mileageUpdatedDate || null, manufactured: v.manufactured,
    engine: v.engine, transmission: v.transmission, drivetrain: v.drivetrain,
    gvwr: v.gvwr, oil_spec: v.oilSpec, oil_note: v.oilNote,
    dmv: v.dmv || {}, tires: v.tires || {},
  };
}
function itemFromRow(r) {
  return {
    id: r.id, row: r.row_num, category: r.category, item: r.item,
    intervalMiles: r.interval_miles, intervalMonths: r.interval_months,
    track: r.track, note: r.note, pkgLevel: r.pkg_level,
  };
}
function itemToRow(vehicleId, it) {
  return {
    vehicle_id: vehicleId, row_num: it.row, category: it.category, item: it.item,
    interval_miles: it.intervalMiles, interval_months: it.intervalMonths,
    track: it.track || "Yes", note: it.note, pkg_level: it.pkgLevel,
  };
}
function logFromRow(r) {
  return {
    id: r.id, date: r.date, vehicle: r.vehicle, odometer: r.odometer, item: r.item,
    cost: r.cost === null ? 0 : Number(r.cost), doneBy: r.done_by, shop: r.shop,
    details: r.details, invoice: r.invoice, notes: r.notes,
  };
}
function logToRow(l) {
  return {
    date: l.date || null, vehicle: l.vehicle, odometer: l.odometer, item: l.item,
    cost: l.cost || 0, done_by: l.doneBy, shop: l.shop, details: l.details,
    invoice: l.invoice, notes: l.notes,
  };
}

// ---------- LOAD everything (same shape as the old fleet_database.json) ----------
async function loadFleetData() {
  const [settings, vehicles, items, logs] = await Promise.all([
    sb.from("settings").select("*"),
    sb.from("vehicles").select("*").order("sort_order").order("name"),
    sb.from("maintenance_items").select("*").order("row_num").order("id"),
    sb.from("service_log").select("*").order("id"),
  ]);
  const s = {};
  check(settings, "Loading settings").forEach(r => { s[r.key] = r.value; });

  const vehs = check(vehicles, "Loading vehicles").map(vehicleFromRow);
  check(items, "Loading schedule items").forEach(r => {
    const v = vehs.find(x => x.id === r.vehicle_id);
    if (v) v.items.push(itemFromRow(r));
  });

  return {
    schemaVersion: s.schemaVersion || "2.0.0",
    lastUpdated: s.lastUpdated || "",
    owner: s.owner || { name: "", address: "", drivers: [] },
    insurance: s.insurance || {},
    thresholds: s.thresholds || {
      miles: { soon: 1000, verySoon: 500, hasToBeDone: 250, overdue: 0 },
      days: { soon: 60, verySoon: 30, hasToBeDone: 14, overdue: 0 },
    },
    vehicles: vehs,
    serviceLog: check(logs, "Loading service log").map(logFromRow),
    vwChecklist: s.vwChecklist || [],
    teslaChecklist: s.teslaChecklist || [],
  };
}

// ---------- SAVE functions (each one changes one thing) ----------
async function touchLastUpdated() {
  const today = todayLocal();   // defined in views.js
  check(await sb.from("settings").upsert({ key: "lastUpdated", value: today }), "Saving date");
}

async function dbSaveSetting(key, value) {
  check(await sb.from("settings").upsert({ key, value }), "Saving " + key);
}

async function dbUpdateMileage(vehicleId, miles, dateStr) {
  check(await sb.from("vehicles")
    .update({ current_mileage: miles, mileage_updated_date: dateStr })
    .eq("id", vehicleId), "Saving mileage");
}

// isNew = true -> insert a new car; otherwise update the existing one
async function dbSaveVehicle(v, isNew) {
  const row = vehicleToRow(v);
  if (isNew) check(await sb.from("vehicles").insert(row), "Adding vehicle");
  else check(await sb.from("vehicles").update(row).eq("id", v.id), "Saving vehicle");
}

async function dbDeleteVehicle(vehicleId) {
  // its schedule items are removed automatically (on delete cascade)
  check(await sb.from("vehicles").delete().eq("id", vehicleId), "Deleting vehicle");
}

async function dbSaveItem(vehicleId, it) {
  const row = itemToRow(vehicleId, it);
  if (it.id) check(await sb.from("maintenance_items").update(row).eq("id", it.id), "Saving schedule item");
  else check(await sb.from("maintenance_items").insert(row), "Adding schedule item");
}

async function dbDeleteItem(itemId) {
  check(await sb.from("maintenance_items").delete().eq("id", itemId), "Deleting schedule item");
}

async function dbSaveLog(l) {
  const row = logToRow(l);
  if (l.id) check(await sb.from("service_log").update(row).eq("id", l.id), "Saving service entry");
  else check(await sb.from("service_log").insert(row), "Adding service entry");
}

async function dbDeleteLog(logId) {
  check(await sb.from("service_log").delete().eq("id", logId), "Deleting service entry");
}
