/**
 * background.js
 * Polling has moved to the cloud server.
 * This file only handles URL translation (used by the add-monitor flow)
 * and keeps the extension alive for tab queries.
 */

const BASE_API = "https://z519wdyajg.execute-api.us-east-1.amazonaws.com/prod/listings";

function pageUrlToApiUrl(pageUrl) {
  try {
    const url = new URL(pageUrl);
    const p   = url.pathname.toLowerCase();
    const apiParams = new URLSearchParams({
      limit: "25", type: p.includes("/clubs") ? "CLUB" : "PLAYER",
      sorts: "listing.createdDateTime", sortsOrders: "DESC",
      status: "AVAILABLE", view: "full"
    });
    const rangeMap = {
      "metadata.age":       ["ageMin","ageMax"],
      "metadata.overall":   ["overallMin","overallMax"],
      "listing.price":      ["priceMin","priceMax"],
      "metadata.pace":      ["paceMin","paceMax"],
      "metadata.shooting":  ["shootingMin","shootingMax"],
      "metadata.passing":   ["passingMin","passingMax"],
      "metadata.dribbling": ["dribblingMin","dribblingMax"],
      "metadata.defense":   ["defenseMin","defenseMax"],
      "metadata.physical":  ["physicalMin","physicalMax"],
      "metadata.height":    ["heightMin","heightMax"],
    };
    for (const [key, val] of url.searchParams.entries()) {
      if (key === "sort") continue;
      if (rangeMap[key]) {
        const [mn, mx] = rangeMap[key];
        const [a, b]   = val.split(":");
        if (a?.trim()) apiParams.set(mn, a.trim());
        if (b?.trim()) apiParams.set(mx, b.trim());
        continue;
      }
      if (["positions.name","positions","position"].includes(key)) { apiParams.set("positions", val); continue; }
      if (key === "activeContract") { if (val.toLowerCase().includes("free")) apiParams.set("isFreeAgent","true"); continue; }
      if (!["page","tab","view","type"].includes(key)) apiParams.set(key, val);
    }
    return `${BASE_API}?${apiParams.toString()}`;
  } catch { return null; }
}

function labelFromPageUrl(pageUrl) {
  try {
    const url  = new URL(pageUrl);
    const p    = url.pathname.toLowerCase();
    const parts = [p.includes("/clubs") ? "Clubs" : "Players"];
    const rangeLabels = {
      "metadata.age":"Age","metadata.overall":"OVR","listing.price":"Price",
      "metadata.pace":"Pac","metadata.shooting":"Sho","metadata.passing":"Pas",
      "metadata.dribbling":"Dri","metadata.defense":"Def","metadata.physical":"Phy",
    };
    for (const [key, val] of url.searchParams.entries()) {
      if (key === "sort") continue;
      if (["positions.name","positions","position"].includes(key)) { parts.push(`Pos:${val}`); continue; }
      if (key === "activeContract" && val.toLowerCase().includes("free")) { parts.push("Free Agent"); continue; }
      if (rangeLabels[key]) {
        const [mn, mx] = val.split(":");
        if (mn && mx) parts.push(`${rangeLabels[key]}${mn}-${mx}`);
        else if (mn)  parts.push(`${rangeLabels[key]}≥${mn}`);
        else if (mx)  parts.push(`${rangeLabels[key]}≤${mx}`);
      }
    }
    return parts.join(" · ") || (p.includes("/clubs") ? "All Clubs" : "All Players");
  } catch { return "Monitor"; }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "translateUrl") {
    sendResponse({
      apiUrl: pageUrlToApiUrl(msg.pageUrl),
      label:  labelFromPageUrl(msg.pageUrl),
    });
    return false;
  }
});
