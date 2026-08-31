const fs = require("fs"); const { JSDOM } = require("jsdom");
const html = fs.readFileSync("tools_Survey_Vessel_Cost_Model.html", "utf8");
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
const w = dom.window; let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } }
function close(a, b, m, tol) { ok(Math.abs(a - b) <= (tol || 1e-6), m + " (" + a + " vs " + b + ")"); }
setTimeout(() => {
  const om = w.__om; ok(!!om, "app loaded");
  // the published tool ships with every rate at zero, so load a configuration before testing money
  ok(!om.SECTIONS.some(s => s.items.some(i => i.on && (i.lo > 0 || i.hi > 0))), "ships with no rates loaded");
  const cfg = JSON.parse(fs.readFileSync("/mnt/user-data/outputs/config-ocean-mapper.json", "utf8"));
  om.applyVessel(cfg);
  ok(om.VESSEL.name === "Ocean Mapper", "Ocean Mapper configuration loads");
  ok(om.VESSEL.lnm[6][4] === 3.6, "fuel curve restored by configuration");
  ok(om.SECTIONS[0].items[0].lo === 600, "cost line rates restored by configuration");
  // round trip: save and reload must be lossless
  const rt = JSON.parse(om.vesselJson());
  ok(rt.lines.length === 28 && rt.lines[0].lo === 600, "configuration round-trips all 28 lines");
  ok(rt.lines[0].driver && rt.lines[0].unit !== undefined, "saved lines carry driver and unit");
  // a custom line added by the user must survive save and reload
  om.SECTIONS[0].items.push({ name: "__TestLine", driver: "total", unit: "day", lo: 111, hi: 222, on: true, svy: true, n: 2, aboard: true });
  const withCustom = JSON.parse(om.vesselJson());
  ok(!!withCustom.lines.find(l => l.name === "__TestLine"), "custom line is saved into the configuration");
  om.SECTIONS[0].items = om.SECTIONS[0].items.filter(i => i.name !== "__TestLine");
  om.applyVessel(withCustom);
  const back = om.SECTIONS[0].items.find(i => i.name === "__TestLine");
  ok(!!back && back.lo === 111 && back.n === 2 && back.driver === "total", "custom line is rebuilt on load");
  om.applyVessel(withCustom);
  ok(om.SECTIONS[0].items.filter(i => i.name === "__TestLine").length === 1, "reloading does not duplicate custom lines");
  const bad = JSON.parse(JSON.stringify(withCustom));
  bad.lines.push({ section: "LABOR", name: "__Bogus", driver: "no_such_driver", unit: "day", lo: 1, hi: 2, on: true });
  let threw = false; try { om.applyVessel(bad); } catch (e) { threw = true; }
  ok(!threw && !om.SECTIONS[0].items.find(i => i.name === "__Bogus"), "unknown driver is skipped, not crashed on");
  om.SECTIONS[0].items = om.SECTIONS[0].items.filter(i => i.name !== "__TestLine");
  // scenario shaped like the Blake Plateau campaign, with the new fields
  om.applyScenario({ schema: "seirios.costmodel.scenario.v1", source: "Endurance Planner campaign (2 areas)",
    area_km2: 34713, distance_nm: 196, endurance_days: 10, port_days: 4, weather_margin_days: 0,
    survey_speed_kt: 8, transit_speed_kt: 10, overlap_pct: 20, coverage_realization_pct: 85,
    depth_bands: [{ label: "1,000 - 2,000 m", depth_m: 1220, share_pct: 51.4, km2_per_day: 1778 },
                  { label: "3,000 - 4,500 m", depth_m: 3375, share_pct: 12.1, km2_per_day: 4988 }],
    mapping_days_override: 15, transit_days_override: 5.1, deployments: 3, port_calls: 5, base_days: 18.3,
    rotation_delta_days: 5.8, routing: "separate mobilisations" });
  const S = om.state, sec = om.SECTIONS;
  ok(S.params.deploy === 3, "deployments imported");
  ok(S.params.calls === 5, "port calls imported");
  ok(S.planner.routing === "separate mobilisations" && S.planner.realization === 85 && S.planner.weatherMargin === 0, "planner routing/realization/weather stored");
  const find = n => { let f = null; sec.forEach(s => s.items.forEach(it => { if (it.name.indexOf(n) === 0) f = it; })); return f; };
  const trav = find("Crew Rotation"), pf = find("Port Fees"), xbt = find("XBT");
  ok(trav.driver === "trips" && trav.unit === "trip", "travel priced per round trip");
  close(om.qtyPair(trav, "all")[0], 3 * om.POB(), "trips = deployments x POB");
  close(om.itemTotals(trav, "all")[0], 3 * 2 * 800, "travel low total 3 dep x 2 pob x $800");
  ok(pf.driver === "calls", "port fees driven by port calls parameter");
  close(om.qtyPair(pf, "all")[0], 5, "port fee qty = port calls");
  // xbt manual, parity count 114; bands should scale
  xbt.driver = "manual"; xbt.qty = 114; xbt._wasXbt = true;
  close(om.qtyPair(xbt, "all")[0], 114, "campaign xbt manual count held");
  const deepDays = 34713 / 4988;
  close(om.qtyPair(xbt, "all", deepDays)[0], 114 * deepDays / 15, "band table scales manual XBT with band days", 1e-6);
  const shallowBand = om.bandSensitivityFromRate(1778, "svy"), deepBand = om.bandSensitivityFromRate(4988, "svy");
  ok(deepBand.kmLo < shallowBand.kmLo, "deeper band is cheaper per km2");
  // day-rate comparator replaces hardcoded text
  const rep = om.reportHtml();
  ok(rep.indexOf("$17,000/day excl. crewing \u00B7") < 0, "no hardcoded NOAA text with km2/day on the day card");
  ok(rep.indexOf("compared day rate to day rate") >= 0, "day card compares day rate to day rate");
  ok(rep.indexOf("km\u00B2/day average") < 0 || rep.indexOf("Average coverage rate") >= 0, "coverage rate is its own card, not on the benchmark card");
  ok(rep.indexOf("Routing") >= 0 && rep.indexOf("Separate mobilisations") >= 0, "report states routing");
  ok(rep.indexOf("Port calls</td><td class='v'>5") >= 0, "report states port calls");
  ok(rep.indexOf("Weather / ops margin") >= 0 && rep.indexOf("calm-water planning") >= 0, "report states weather margin");
  ok(rep.indexOf("Coverage realization</td><td class='v'>85%") >= 0, "report states coverage realization");
  ok(rep.indexOf("XBTs per mapping day") < 0, "assumptions block drops per-day XBT row when the line is manual");
  ok(rep.indexOf("XBT Probes</td><td class='v'>114 ea (manual quantity") >= 0, "assumptions block lists the manual XBT count");
  ok(rep.indexOf("24.1</td><td class='num'>day") >= 0, "qty column shows 24.1 not 24");
  ok(rep.indexOf("one per person per deployment") >= 0, "person-day vs trip convention printed");
  ok(rep.indexOf("not simply the day rate divided by the coverage rate") >= 0, "depth band convention printed");
  ok(rep.indexOf("Model figures are base cost") >= 0 && rep.indexOf("Benchmark figures are contracted prices") >= 0, "base cost vs price note printed");
  // switch xbt back to driver: per-day row returns
  xbt.driver = "xbt"; const rep2 = om.reportHtml(); ok(rep2.indexOf("XBTs per mapping day") >= 0, "per-day XBT row returns when driver is xbt");
  xbt.driver = "manual";
  // workbook
  om.resetUsed(); const wsAll = om.buildModelSheet("all"), wsSvy = om.buildModelSheet("svy"), wsP = om.buildParamsSheet();
  const X = w.XLSX; const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, wsP, "Parameters"); X.utils.book_append_sheet(wb, om.buildBandsSheet(), "Depth Bands");
  X.utils.book_append_sheet(wb, wsAll, "Campaign Model"); X.utils.book_append_sheet(wb, wsSvy, "Survey-Only Model");
  fs.writeFileSync("export_v4.xlsx", Buffer.from(X.write(wb, { bookType: "xlsx", type: "array" })));
  const pa = X.utils.sheet_to_json(wsP, { header: 1 });
  const used = {}; pa.slice(1).forEach(r => used[r[0]] = r[2]);
  ok(pa[0][2] === "Used by", "Parameters sheet has Used by column");
  ok(/Crew Rotation/.test(used["Deployments"]) && /Port Fees/.test(used["Port calls"]), "deployments and port calls referenced by their lines");
  ok(/not referenced: the XBT line/.test(used["XBTs per mapping day"]), "XBT per-day param flagged as not referenced");
  ok(/fuel curve/.test(used["Hotel load survey (kW)"]), "hotel load explained");
  ok(/Contingency/.test(used["Contingency (%)"]) && /Contingency/.test(used["Contingency applied"]), "contingency params referenced by the contingency row");
  const svyRows = X.utils.sheet_to_json(wsSvy, { header: 1 }).map(r => r[0]);
  ok(svyRows.indexOf("TOTAL SURVEY-ONLY COST") >= 0 && svyRows.indexOf("TOTAL CAMPAIGN COST") < 0, "survey-only total row relabelled");
  console.log(fail ? "FAILURES " + fail : "ALL_TESTS_PASS " + pass);
}, 400);
