// =====================================================================
// views.js - draws every screen of the dashboard (Fleet Website)
//
// This code is copied from the old Fleet_Dashboard.html so the due-date
// math and the look are IDENTICAL to the desktop app. It only READS the
// global variable DB (filled from Supabase by data.js). Saving is done
// in app.js. Small website changes are marked "website:".
// =====================================================================

let DB = null;                  // website: filled by loadFleetData() in data.js
let currentVehicle = "all";     // 'all' or a vehicle id ('passat', 'atlas', 'tesla')
let currentSection = "dashboard"; // 'dashboard','tires','servicelog','checklists','insurance','manage'

// website: today's date as YYYY-MM-DD in YOUR time zone
function todayLocal() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Core Excel-Identical Calculation Engine!
// Matches Dash_Passat, Dash_Atlas, Dash_Tesla formulas (MAXIFS + PACKAGE inheritance + Even 5,000-mile rounding + Stepped Alerts)
function computeVehicleItems(veh) {
  const curMi = Number(veh.currentMileage) || 0;
  const today = new Date();
  const logs = DB.serviceLog.filter(l => l.vehicle === veh.name);
  const tMi = DB.thresholds.miles;
  const tDays = DB.thresholds.days;

  const pkgNames = {
    1: "PACKAGE: Minor service (10k)",
    2: "PACKAGE: Standard service (20k)",
    3: "PACKAGE: Extended service (40k)"
  };

  const computed = veh.items.map(it => {
    if (it.track !== "Yes") {
      return {
        ...it,
        lastMiles: null,
        lastDate: "",
        nextMiles: null,
        milesLeft: null,
        nextDate: "",
        daysLeft: null,
        status: "Not tracked",
        rank: 99,
        sortKey: 99999999
      };
    }

    // Find max miles & max date from ServiceLog (including PACKAGE rows if pkgLevel is set!)
    let maxMi = 0;
    let maxDateStr = "";
    for (const row of logs) {
      let match = (row.item === it.item);
      if (!match && it.pkgLevel) {
        if (it.pkgLevel <= 1 && row.item === pkgNames[1]) match = true;
        if (it.pkgLevel <= 2 && row.item === pkgNames[2]) match = true;
        if (it.pkgLevel <= 3 && row.item === pkgNames[3]) match = true;
      }
      if (match) {
        if (row.odometer && row.odometer > maxMi) maxMi = row.odometer;
        if (row.date && row.date > maxDateStr) maxDateStr = row.date;
      }
    }

    const lastMiles = maxMi > 0 ? maxMi : null;
    const lastDate = maxDateStr || "";

    // Next Due Miles: Clean Even 5,000-mile math when intervalMiles is a multiple of 5,000!
    let nextMiles = null;
    let milesLeft = null;
    if (it.intervalMiles && lastMiles !== null) {
      if (it.intervalMiles % 5000 === 0) {
        nextMiles = Math.round((lastMiles + it.intervalMiles) / 5000) * 5000;
      } else {
        nextMiles = lastMiles + it.intervalMiles;
      }
      if (curMi > 0) {
        milesLeft = nextMiles - curMi;
      }
    }

    // Next Due Date (EDATE equivalent)
    let nextDate = "";
    let daysLeft = null;
    if (it.intervalMonths && lastDate) {
      const parts = lastDate.split("-").map(Number);
      const d = new Date(parts[0], parts[1] - 1 + Number(it.intervalMonths), parts[2]);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      nextDate = `${yyyy}-${mm}-${dd}`;
      const diffMs = d.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
      daysLeft = Math.round(diffMs / 86400000);
    }

    // Status evaluation (matches Column L in Excel!)
    let status = "OK";
    if (nextMiles === null && !nextDate) {
      status = "NO RECORD";
    } else if ((milesLeft !== null && milesLeft <= 0) || (daysLeft !== null && daysLeft <= 0)) {
      status = "OVERDUE";
    } else if ((milesLeft !== null && milesLeft <= tMi.hasToBeDone) || (daysLeft !== null && daysLeft <= tDays.hasToBeDone)) {
      status = "HAS TO BE DONE";
    } else if ((milesLeft !== null && milesLeft <= tMi.verySoon) || (daysLeft !== null && daysLeft <= tDays.verySoon)) {
      status = "VERY SOON";
    } else if ((milesLeft !== null && milesLeft <= tMi.soon) || (daysLeft !== null && daysLeft <= tDays.soon)) {
      status = "SOON";
    } else {
      status = "OK";
    }

    const rankMap = {
      "OVERDUE": 1,
      "HAS TO BE DONE": 2,
      "VERY SOON": 3,
      "SOON": 4,
      "OK": 5,
      "NO RECORD": 6,
      "Not tracked": 99
    };
    const rank = rankMap[status] || 99;
    const effLeft = Math.min(
      milesLeft !== null ? milesLeft : 999999,
      daysLeft !== null ? daysLeft * 25 : 999999
    );
    const sortKey = rank * 10000000 + effLeft + it.row * 0.01;

    return {
      ...it,
      vehicleId: veh.id,
      vehicleName: veh.name,
      lastMiles,
      lastDate,
      nextMiles,
      milesLeft,
      nextDate,
      daysLeft,
      status,
      rank,
      sortKey
    };
  });

  const counts = {
    "OVERDUE": 0,
    "HAS TO BE DONE": 0,
    "VERY SOON": 0,
    "SOON": 0,
    "OK": 0,
    "NO RECORD": 0
  };
  for (const c of computed) {
    if (counts[c.status] !== undefined) counts[c.status]++;
  }

  const nextUp = computed
    .filter(c => c.rank < 99)
    .sort((a, b) => a.sortKey - b.sortKey)
    .slice(0, 5);

  const totalSpend = logs.reduce((acc, r) => acc + (Number(r.cost) || 0), 0);

  return { computed, counts, nextUp, totalSpend };
}

function statusClass(st) {
  return "st-" + st.replace(/\s+/g, "");
}

function fmtNum(n) {
  if (n === null || n === undefined || n === "") return "—";
  return Number(n).toLocaleString("en-US");
}

function fmtMoney(n) {
  return "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function setVehicle(vId) {
  currentVehicle = vId;
  renderAll();
}

function setSection(sec) {
  currentSection = sec;
  document.querySelectorAll(".sub-btn").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-sec") === sec);
  });
  renderAll();
}


function renderVehicleTabs() {
  const container = document.getElementById("vehicleTabs");
  const allStats = DB.vehicles.map(v => ({ v, res: computeVehicleItems(v) }));
  const totalUrgent = allStats.reduce(
    (s, x) => s + x.res.counts["OVERDUE"] + x.res.counts["HAS TO BE DONE"] + x.res.counts["VERY SOON"] + x.res.counts["SOON"],
    0
  );

  let html = `
    <button class="v-tab ${currentVehicle === 'all' ? 'active' : ''}" onclick="setVehicle('all')">
      <div class="v-tab-top">
        <span class="v-tab-name">🚘 All 3 Cars (Fleet View)</span>
        <span class="v-pill" style="background:#4f46e5;">3 Vehicles</span>
      </div>
      <div class="v-tab-sub">
        <span>Passat • Atlas • Model Y</span>
        <span>${totalUrgent} Action Items</span>
      </div>
    </button>
  `;

  for (const { v, res } of allStats) {
    const urgent = res.counts["OVERDUE"] + res.counts["HAS TO BE DONE"] + res.counts["VERY SOON"] + res.counts["SOON"];
    html += `
      <button class="v-tab ${currentVehicle === v.id ? 'active' : ''}" onclick="setVehicle('${v.id}')">
        <div class="v-tab-top">
          <span class="v-tab-name">${v.shortLabel}</span>
          <span class="v-pill" style="background:${v.badgeColor};">${fmtNum(v.currentMileage)} mi</span>
        </div>
        <div class="v-tab-sub">
          <span>VIN: ...${(v.vin || "").slice(-6)}</span>
          <span>${urgent > 0 ? urgent + ' Soon/Due' : 'All OK ✓'}</span>
        </div>
      </button>
    `;
  }
  container.innerHTML = html;

  // Update mobile bottom nav active button
  const mBtns = document.querySelectorAll("#mobileNav .m-nav-btn");
  const mapIdx = { all: 0 }; DB.vehicles.forEach((v, i) => { mapIdx[v.id] = i + 1; });
  mBtns.forEach((b, i) => b.classList.toggle("active", i === mapIdx[currentVehicle]));

  document.getElementById("logCountBadge").textContent = DB.serviceLog.length;
}

function renderStatusStrip(counts) {
  const keys = [
    ["OVERDUE", "OVERDUE"],
    ["HAS TO BE DONE", "HAS TO BE DONE (≤250 mi)"],
    ["VERY SOON", "VERY SOON (≤500 mi)"],
    ["SOON", "SOON (≤1,000 mi)"],
    ["OK", "OK"],
    ["NO RECORD", "NO RECORD"]
  ];
  return `
    <div class="status-strip">
      ${keys.map(([k, lbl]) => `
        <div class="stat-box">
          <div class="stat-label ${statusClass(k)}">${lbl}</div>
          <div class="stat-val">${counts[k] || 0}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderDashboardView() {
  const vehiclesToShow = currentVehicle === "all"
    ? DB.vehicles
    : DB.vehicles.filter(v => v.id === currentVehicle);

  // Aggregate status counts
  const aggCounts = { "OVERDUE": 0, "HAS TO BE DONE": 0, "VERY SOON": 0, "SOON": 0, "OK": 0, "NO RECORD": 0 };
  const vehResults = vehiclesToShow.map(v => {
    const res = computeVehicleItems(v);
    for (const k of Object.keys(aggCounts)) aggCounts[k] += res.counts[k];
    return { v, res };
  });

  let html = renderStatusStrip(aggCounts);

  // If Fleet View ('all'), show the 3-car side-by-side summary cards + unified Top Urgent table
  if (currentVehicle === "all") {
    html += `<div class="grid-3">`;
    for (const { v, res } of vehResults) {
      const top3 = res.nextUp.slice(0, 3);
      html += `
        <div class="card" style="margin-bottom:0; border-top: 4px solid ${v.badgeColor};">
          <div class="card-hdr">
            <div>
              <div class="card-title">${v.fullName}</div>
              <div style="font-size:12px; color:var(--text-muted);">VIN: ${v.vin} • Plate: ${v.plate}</div>
            </div>
            <button class="btn" onclick="setVehicle('${v.id}')">Open Tab →</button>
          </div>
          <div class="odo-input-group" style="justify-content:space-between; margin-bottom:12px;">
            <div>
              <label>CURRENT MILEAGE</label>
              <div style="font-size:11px; color:var(--text-muted);">Updated: ${v.mileageUpdatedDate}</div>
            </div>
            <div style="display:flex; gap:6px; align-items:center;">
              <input class="odo-input" type="number" value="${v.currentMileage}" onchange="updateOdometer('${v.id}', this.value)" />
              <span style="font-size:12px; font-weight:700;">mi</span>
            </div>
          </div>
          <div class="kv-list" style="margin-bottom:12px;">
            <div class="kv-row"><span class="kv-key">Tires & Cold PSI</span><span class="kv-val">${v.tires.sizeFrontRear} @ ${v.tires.psiFront} PSI</span></div>
            <div class="kv-row"><span class="kv-key">NYS Inspection Exp</span><span class="kv-val">${v.dmv.inspectionExpires}</span></div>
            <div class="kv-row"><span class="kv-key">NY Registration Exp</span><span class="kv-val">${v.dmv.registrationExpires}</span></div>
            <div class="kv-row"><span class="kv-key">Logged Spend</span><span class="kv-val">${fmtMoney(res.totalSpend)}</span></div>
          </div>
          <div style="font-size:12px; font-weight:800; margin-bottom:6px; color:var(--accent);">NEXT 3 UPCOMING MILESTONES:</div>
          ${top3.map((it, idx) => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-top:1px solid var(--border); font-size:12px;">
              <div>
                <strong>#${idx+1} ${it.item}</strong>
                <div style="color:var(--text-muted); font-size:11px;">
                  ${it.nextMiles ? 'Due @ ' + fmtNum(it.nextMiles) + ' mi (' + fmtNum(it.milesLeft) + ' mi left)' : ''}
                  ${it.nextDate ? (it.nextMiles ? ' • ' : '') + 'Due ' + it.nextDate + ' (' + it.daysLeft + 'd left)' : ''}
                </div>
              </div>
              <span class="badge ${statusClass(it.status)}">${it.status}</span>
            </div>
          `).join("")}
        </div>
      `;
    }
    html += `</div>`;
  }

  // Render detailed dashboard for each selected vehicle (matches Dash_Passat / Dash_Atlas / Dash_Tesla!)
  for (const { v, res } of vehResults) {
    html += `
      <div class="card" style="border-left: 4px solid ${v.badgeColor};">
        <div class="card-hdr" style="flex-wrap:wrap;">
          <div>
            <div class="card-title" style="font-size:17px;">${v.fullName} — Maintenance Dashboard</div>
            <div style="font-size:12px; color:var(--text-muted);">
              VIN: <strong>${v.vin}</strong> | NY Plate: <strong>${v.plate}</strong> | Oil/Powertrain: ${v.oilSpec} | Tires: <strong>${v.tires.sizeFrontRear} @ ${v.tires.psiFront} PSI cold</strong>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
            <div class="odo-input-group">
              <label>CURRENT MILEAGE:</label>
              <input class="odo-input" type="number" value="${v.currentMileage}" onchange="updateOdometer('${v.id}', this.value)" />
            </div>
            <div style="background:var(--bg-card-alt); padding:8px 12px; border-radius:8px; border:1px solid var(--border); font-size:12px;">
              Total Logged Spend: <strong>${fmtMoney(res.totalSpend)}</strong>
            </div>
          </div>
        </div>

        <!-- NEXT UP - MOST URGENT FIRST (Top 5 Table matching Rows 8-14 of Excel!) -->
        <div style="margin-bottom:16px;">
          <div style="background:#f1f5f9; color:#0f172a; border:1px solid #e2e8f0; border-bottom:none; font-weight:700; padding:8px 12px; border-radius:8px 8px 0 0; font-size:13px;">
            NEXT UP — MOST URGENT FIRST (Top 5)
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style="width:45px;">#</th>
                  <th>Service Item</th>
                  <th class="num">Next Due (mi)</th>
                  <th class="num">Miles Left</th>
                  <th class="center">Next Due (date)</th>
                  <th class="num">Days Left</th>
                  <th class="center">STATUS</th>
                </tr>
              </thead>
              <tbody>
                ${res.nextUp.map((it, idx) => `
                  <tr>
                    <td class="center"><strong>${idx + 1}</strong></td>
                    <td><strong>${it.item}</strong></td>
                    <td class="num"><strong>${fmtNum(it.nextMiles)}</strong></td>
                    <td class="num">${fmtNum(it.milesLeft)}</td>
                    <td class="center">${it.nextDate || "—"}</td>
                    <td class="num">${it.daysLeft !== null ? it.daysLeft : "—"}</td>
                    <td class="center"><span class="badge ${statusClass(it.status)}">${it.status}</span></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>

        <!-- ALL ITEMS TABLE (Matching Rows 16-41 of Excel!) -->
        <div>
          <div style="background:#f1f5f9; color:#0f172a; border:1px solid #e2e8f0; border-bottom:none; font-weight:700; padding:8px 12px; border-radius:8px 8px 0 0; font-size:13px;">
            ALL ITEMS — Even 5,000-Mile Milestones & Calendar Date Tracking
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Service Item</th>
                  <th class="num">Interval (mi)</th>
                  <th class="center">Interval (mos)</th>
                  <th class="center">Track?</th>
                  <th class="num">Last Done (mi)</th>
                  <th class="center">Last Done (date)</th>
                  <th class="num">Next Due (mi)</th>
                  <th class="num">Miles Left</th>
                  <th class="center">Next Due (date)</th>
                  <th class="num">Days Left</th>
                  <th class="center">STATUS</th>
                  <th>Source / Spec Note</th>
                </tr>
              </thead>
              <tbody>
                ${res.computed.map(it => `
                  <tr style="${it.track !== 'Yes' ? 'opacity:0.45;' : ''}">
                    <td>${it.category}</td>
                    <td><strong>${it.item}</strong></td>
                    <td class="num">${fmtNum(it.intervalMiles)}</td>
                    <td class="center">${it.intervalMonths || "—"}</td>
                    <td class="center">${it.track}</td>
                    <td class="num">${fmtNum(it.lastMiles)}</td>
                    <td class="center">${it.lastDate || "—"}</td>
                    <td class="num"><strong>${fmtNum(it.nextMiles)}</strong></td>
                    <td class="num"><strong>${fmtNum(it.milesLeft)}</strong></td>
                    <td class="center">${it.nextDate || "—"}</td>
                    <td class="num">${it.daysLeft !== null ? it.daysLeft : "—"}</td>
                    <td class="center"><span class="badge ${statusClass(it.status)}">${it.status}</span></td>
                    <td style="font-size:12px; color:var(--text-muted); max-width:340px;">${it.note}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }
  return html;
}

function renderTiresView() {
  const vehiclesToShow = currentVehicle === "all"
    ? DB.vehicles
    : DB.vehicles.filter(v => v.id === currentVehicle);

  let html = "";
  for (const v of vehiclesToShow) {
    const t = v.tires;
    const curMi = Number(v.currentMileage) || 0;
    const driven = Math.max(0, curMi - t.installMiles);
    const warrEnd = t.installMiles + t.warrantyMiles;
    const warrLeft = Math.max(0, warrEnd - curMi);
    const pctUsed = Math.min(100, Math.round((driven / t.warrantyMiles) * 100));

    // Build 16-step 5,000-mile Even Rotation Ladder
    const logs = DB.serviceLog.filter(l => l.vehicle === v.name && l.item === "Tire rotation");
    const lastRotMi = logs.reduce((m, r) => Math.max(m, Number(r.odometer) || 0), 0);

    let ladderRows = "";
    for (let step = 1; step <= 16; step++) {
      const schedMi = Math.round((t.installMiles + step * t.rotationInterval) / 5000) * 5000;
      if (schedMi > warrEnd + 5000) break;
      const isDone = (Math.round(lastRotMi / 5000) * 5000) >= schedMi;
      const miLeft = isDone ? null : schedMi - curMi;
      let st = "OK";
      if (isDone) st = "OK";
      else if (miLeft <= 0) st = "OVERDUE";
      else if (miLeft <= 250) st = "HAS TO BE DONE";
      else if (miLeft <= 500) st = "VERY SOON";
      else if (miLeft <= 1000) st = "SOON";

      ladderRows += `
        <tr>
          <td class="center"><strong>Rotation #${step}</strong></td>
          <td class="num"><strong>${fmtNum(schedMi)} mi</strong></td>
          <td class="center">${isDone ? "✅ Done" : "⏳ Pending"}</td>
          <td class="num">${isDone ? "—" : fmtNum(miLeft) + " mi"}</td>
          <td class="center"><span class="badge ${statusClass(st)}">${isDone ? "DONE" : st}</span></td>
          <td style="font-size:12px; color:var(--text-muted);">Rotate @ ${fmtNum(schedMi)} mi • Verify ${t.psiFront} PSI Front / ${t.psiRear} PSI Rear cold</td>
        </tr>
      `;
    }

    html += `
      <div class="card" style="border-left: 4px solid ${v.badgeColor};">
        <div class="card-hdr">
          <div class="card-title">🛞 ${v.fullName} — Tire Plan & 5,000-Mile Rotation Schedule</div>
          <span class="v-pill" style="background:${v.badgeColor};">Cold PSI: ${t.psiFront} F / ${t.psiRear} R</span>
        </div>
        <div class="grid-2">
          <div class="kv-list">
            <div class="kv-row"><span class="kv-key">Tire Brand & Model</span><span class="kv-val">${t.brandModel}</span></div>
            <div class="kv-row"><span class="kv-key">Size & Load Rating</span><span class="kv-val">${t.sizeFrontRear}</span></div>
            <div class="kv-row"><span class="kv-key">Cold Tire Pressure</span><span class="kv-val">${t.psiFront} PSI Front / ${t.psiRear} PSI Rear</span></div>
            <div class="kv-row"><span class="kv-key">Spare Tire Spec</span><span class="kv-val">${t.spare}</span></div>
            <div class="kv-row"><span class="kv-key">Shop / Purchase Invoice</span><span class="kv-val">${t.shop}</span></div>
            <div class="kv-row"><span class="kv-key">DOT Tire Codes</span><span class="kv-val">${t.dot}</span></div>
          </div>
          <div class="kv-list">
            <div class="kv-row"><span class="kv-key">Install / Baseline Odometer</span><span class="kv-val">${fmtNum(t.installMiles)} mi (${t.installDate})</span></div>
            <div class="kv-row"><span class="kv-key">Current Odometer</span><span class="kv-val">${fmtNum(curMi)} mi</span></div>
            <div class="kv-row"><span class="kv-key">Miles Driven on Set</span><span class="kv-val">${fmtNum(driven)} mi (${pctUsed}% of warranty)</span></div>
            <div class="kv-row"><span class="kv-key">Treadwear Warranty Limit</span><span class="kv-val">${fmtNum(t.warrantyMiles)} mi (Ends @ ${fmtNum(warrEnd)} mi)</span></div>
            <div class="kv-row"><span class="kv-key">Warranty Miles Remaining</span><span class="kv-val">${fmtNum(warrLeft)} mi</span></div>
            <div style="padding-top:6px;">
              <div style="font-size:11px; color:var(--text-muted); display:flex; justify-content:space-between;">
                <span>Treadwear Warranty Progress</span><span>${pctUsed}%</span>
              </div>
              <div class="prog-bar"><div class="prog-fill" style="width:${pctUsed}%; background:${v.badgeColor};"></div></div>
            </div>
          </div>
        </div>
        <div class="table-wrap" style="margin-top:12px;">
          <table>
            <thead>
              <tr>
                <th class="center">Rotation #</th>
                <th class="num">Scheduled Miles (Even 5k)</th>
                <th class="center">Completed?</th>
                <th class="num">Miles Left</th>
                <th class="center">Status</th>
                <th>Rotation & Pressure Note</th>
              </tr>
            </thead>
            <tbody>${ladderRows}</tbody>
          </table>
        </div>
      </div>
    `;
  }
  return html;
}

function renderServiceLogView() {
  const filtered = DB.serviceLog
    .filter(r => {
      if (currentVehicle === "all") return true;
      const v = DB.vehicles.find(x => x.id === currentVehicle);
      return v && r.vehicle === v.name;
    })
    .slice()
    .sort((a, b) => (b.date.localeCompare(a.date) || b.odometer - a.odometer));

  const totalCost = filtered.reduce((s, r) => s + (Number(r.cost) || 0), 0);

  return `
    <div class="card">
      <div class="card-hdr">
        <div>
          <div class="card-title">📋 Complete Service History & Baseline Log (${filtered.length} entries)</div>
          <div style="font-size:12px; color:var(--text-muted);">Every entry automatically updates Last Done Miles & Date on the vehicle dashboards.</div>
        </div>
        <div style="display:flex; gap:10px; align-items:center;">
          <span style="font-size:13px;">Total Spend Shown: <strong>${fmtMoney(totalCost)}</strong></span>
          <button class="btn btn-primary" onclick="openLogModal()">+ Add Service Entry</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Vehicle</th>
              <th class="num">Odometer (mi)</th>
              <th>Service Item</th>
              <th class="num">Cost ($)</th>
              <th>Done By</th>
              <th>Shop / Vendor</th>
              <th>Details (Parts, Oil, Tires)</th>
              <th>Invoice / Ref</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(r => `
              <tr>
                <td style="white-space:nowrap;">${r.date}</td>
                <td><strong>${r.vehicle}</strong></td>
                <td class="num"><strong>${fmtNum(r.odometer)}</strong></td>
                <td><strong>${r.item}</strong></td>
                <td class="num">${r.cost ? fmtMoney(r.cost) : "—"}</td>
                <td>${r.doneBy}</td>
                <td>${r.shop}</td>
                <td style="font-size:12px;">${r.details}</td>
                <td style="font-size:12px;">${r.invoice}</td>
                <td style="font-size:12px; color:var(--text-muted);">${r.notes}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderChecklistsView() {
  return `
    <div class="card">
      <div class="card-hdr">
        <div class="card-title">✅ VW Official Service Package Content (2014 Passat & 2018 Atlas)</div>
        <span style="font-size:12px; color:var(--text-muted);">Source: VW Group of America US Maintenance Schedules</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Package Level</th>
              <th>Inspection / Service Item</th>
              <th>2014 VW Passat (1.8L TSI)</th>
              <th>2018 VW Atlas (3.6L VR6 4MOTION)</th>
              <th>VW Notes</th>
            </tr>
          </thead>
          <tbody>
            ${DB.vwChecklist.map(r => `
              <tr>
                <td><strong>${r.level}</strong></td>
                <td><strong>${r.item}</strong></td>
                <td>${r.passat2014}</td>
                <td>${r.atlas2018}</td>
                <td style="font-size:12px; color:var(--text-muted);">${r.notes}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-hdr">
        <div class="card-title">⚡ 2026 Tesla Model Y Official Maintenance Schedule</div>
        <span style="font-size:12px; color:var(--text-muted);">Source: Tesla Model Y Owner's Manual</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Service Item</th>
              <th>Recommended Schedule</th>
              <th>DIY or Service</th>
              <th>Tesla / WNY Climate Notes</th>
            </tr>
          </thead>
          <tbody>
            ${DB.teslaChecklist.map(r => `
              <tr>
                <td><strong>${r.item}</strong></td>
                <td>${r.schedule}</td>
                <td>${r.diyOrService}</td>
                <td style="font-size:12px; color:var(--text-muted);">${r.notes}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderInsuranceView() {
  const ins = DB.insurance;
  return `
    <div class="grid-2">
      <div class="card" style="margin-bottom:0;">
        <div class="card-hdr">
          <div class="card-title">🛡️ Household Auto Insurance & Agency Details</div>
          <span class="v-pill" style="background:#059669;">Policy #${ins.policyNumber}</span>
        </div>
        <div class="kv-list">
          <div class="kv-row"><span class="kv-key">Named Insured</span><span class="kv-val">${DB.owner.name}</span></div>
          <div class="kv-row"><span class="kv-key">Garaging Address</span><span class="kv-val">${DB.owner.address}</span></div>
          <div class="kv-row"><span class="kv-key">Insurance Carrier</span><span class="kv-val">${ins.carrier}</span></div>
          <div class="kv-row"><span class="kv-key">Policy Number</span><span class="kv-val">#${ins.policyNumber}</span></div>
          <div class="kv-row"><span class="kv-key">Current Auto Premium</span><span class="kv-val">${fmtMoney(ins.monthlyPremium)}/mo (${fmtMoney(ins.monthlyPremium * 12)}/yr)</span></div>
          <div class="kv-row"><span class="kv-key">Insurance Agency</span><span class="kv-val">${ins.agency} (${ins.agencyAddress})</span></div>
          <div class="kv-row"><span class="kv-key">Dedicated Agent</span><span class="kv-val">${ins.agentName} • ${ins.agentPhone}</span></div>
          <div class="kv-row"><span class="kv-key">Agent Email</span><span class="kv-val"><a href="mailto:${ins.agentEmail}" style="color:var(--accent);">${ins.agentEmail}</a></span></div>
        </div>
      </div>

      <div class="card" style="margin-bottom:0;">
        <div class="card-hdr">
          <div class="card-title">☁️ OneDrive Cloud Architecture & Direct Links</div>
          <button class="btn" onclick="reloadFromCloud()">↻ Reload from Cloud</button>
        </div>
        <div class="kv-list">
          <div class="kv-row">
            <span class="kv-key">📗 Master 3-Car Excel Tracker</span>
            <span class="kv-val"><a href="https://onedrive.live.com/personal/b7a8fd0edf0f3ecc/_layouts/15/doc.aspx?resid=6244e3d4-5748-4a4f-b9ac-0c3182a2c022&cid=b7a8fd0edf0f3ecc" target="_blank" style="color:var(--accent);">Open in Excel Online ↗</a></span>
          </div>
          <div class="kv-row">
            <span class="kv-key">🚗 2014 VW Passat Excel Tracker</span>
            <span class="kv-val"><a href="https://onedrive.live.com/personal/b7a8fd0edf0f3ecc/_layouts/15/doc.aspx?resid=fbfc2c98-9150-4dcd-a9ca-0a1a91f096e3&cid=b7a8fd0edf0f3ecc" target="_blank" style="color:var(--accent);">Open Passat Excel ↗</a></span>
          </div>
          <div class="kv-row">
            <span class="kv-key">🚙 2018 VW Atlas Excel Tracker</span>
            <span class="kv-val"><a href="https://onedrive.live.com/personal/b7a8fd0edf0f3ecc/_layouts/15/doc.aspx?resid=07a1c7ba-a328-4ed8-b10d-6f8889ecc24d&cid=b7a8fd0edf0f3ecc" target="_blank" style="color:var(--accent);">Open Atlas Excel ↗</a></span>
          </div>
          <div class="kv-row">
            <span class="kv-key">⚡ 2026 Tesla Model Y Excel Tracker</span>
            <span class="kv-val"><a href="https://onedrive.live.com/personal/b7a8fd0edf0f3ecc/_layouts/15/doc.aspx?resid=fb937839-6b1b-4eb3-bd18-0ef65b763911&cid=b7a8fd0edf0f3ecc" target="_blank" style="color:var(--accent);">Open Tesla Excel ↗</a></span>
          </div>
          <div class="kv-row">
            <span class="kv-key">📁 OneDrive Fleet Dashboard Folder</span>
            <span class="kv-val"><a href="https://onedrive.live.com?cid=B7A8FD0EDF0F3ECC&id=B7A8FD0EDF0F3ECC!sd0cf4c14b5de4a399e78839b75aa8c38" target="_blank" style="color:var(--accent);">Open Cloud Folder ↗</a></span>
          </div>
          <div class="kv-row">
            <span class="kv-key">📱 Laptop & Samsung S25 Ultra Shortcut Tip</span>
            <span class="kv-val">Open this website in any browser. On the S25 Ultra: Chrome menu ⋮ → "Add to Home screen".</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAll() {
  renderVehicleTabs();
  const root = document.getElementById("viewRoot");
  if (currentSection === "dashboard") root.innerHTML = renderDashboardView();
  else if (currentSection === "tires") root.innerHTML = renderTiresView();
  else if (currentSection === "servicelog") root.innerHTML = renderServiceLogView();
  else if (currentSection === "checklists") root.innerHTML = renderChecklistsView();
  else if (currentSection === "insurance") root.innerHTML = renderInsuranceView();
  else if (currentSection === "manage") root.innerHTML = renderManageView(); // website: in app.js
}

// Modal & Export/Import Functions
function openLogModal() {
  document.getElementById("logDate").value = todayLocal();
  const vehSel = document.getElementById("logVehicle");
  if (currentVehicle !== "all") {
    const v = DB.vehicles.find(x => x.id === currentVehicle);
    if (v) {
      vehSel.value = v.name;
      document.getElementById("logOdo").value = v.currentMileage;
    }
  } else {
    document.getElementById("logOdo").value = DB.vehicles[0].currentMileage;
  }
  populateServiceItemDropdown();
  document.getElementById("logModal").style.display = "flex";
}

function closeLogModal() {
  document.getElementById("logModal").style.display = "none";
}

function populateServiceItemDropdown() {
  const vehName = document.getElementById("logVehicle").value;
  const v = DB.vehicles.find(x => x.name === vehName) || DB.vehicles[0];
  document.getElementById("logOdo").value = v.currentMileage;
  const sel = document.getElementById("logItem");
  const pkgs = [
    "PACKAGE: Minor service (10k)",
    "PACKAGE: Standard service (20k)",
    "PACKAGE: Extended service (40k)"
  ];
  const items = v.items.map(i => i.item);
  const allOpts = [...pkgs, ...items];
  sel.innerHTML = allOpts.map(o => `<option value="${o}">${o}</option>`).join("");
}

function exportDatabaseJSON() {
  const dataStr = JSON.stringify(DB, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "fleet_database.json";
  a.click();
  URL.revokeObjectURL(url);
}

function exportServiceLogCSV() {
  const headers = ["Date", "Vehicle", "Odometer (mi)", "Service item", "Cost ($)", "Done by", "Shop / vendor", "Details", "Invoice / RO #", "Notes"];
  const rows = DB.serviceLog.map(r => [
    r.date, r.vehicle, r.odometer, r.item, r.cost || "", r.doneBy, r.shop, r.details, r.invoice, r.notes
  ]);
  const csv = [headers, ...rows]
    .map(row => row.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Fleet_ServiceLog.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function toggleTheme() {
  const htmlEl = document.documentElement;
  const next = htmlEl.getAttribute("data-theme") === "dark" ? "light" : "dark";
  htmlEl.setAttribute("data-theme", next);
  document.getElementById("themeBtn").textContent = next === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode";
}

