/**
 * Polymarket cash, positions, and CLOB collateral.
 *   node check-balance.js
 */

const crypto = require("crypto");
const https = require("https");

const PM_API_KEY = "019c2e94-4d1c-7180-9d60-27477530440b";
const PM_API_SECRET = "nFkvcD2cX1z-UI5SyRIKNUBS6wglh6kh73TtYbA1GqU=";
const PM_API_PASSPHRASE = "0dfd6a545d4e834597a6e856656bf5b79a25cf12c9d1dd0d247f98610cd00c4c";

const PM_PROXY_ADDRESS = "0xA2D69C1C854609E6e38C3092ED6d6e2155EF0e2c";
const PM_ACCOUNT_ADDRESS = "0x8cc14f9569e6D7453E20DDC4aa20fB3CDaFb1594";
const PM_DEPOSIT_ADDRESS = "0xB3C21501F46B719630293b53b99cB70826031d4A";
const PM_EXTRA_ADDRESSES = "0x49EcfB5dE6fdEF42b77d94537F267c9c18fc17AE";

const DATA_API = "https://data-api.polymarket.com/v2";
const CLOB = "https://clob.polymarket.com";
const RPC = "https://polygon-bor-rpc.publicnode.com";

const TOKENS = [
  ["pUSD", "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB"],
  ["USDC.e", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"],
  ["USDC", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"],
];

const SIGNATURE_TYPES = [
  [0, "EOA"],
  [1, "POLY_PROXY"],
  [2, "POLY_GNOSIS_SAFE"],
  [3, "POLY_1271"],
];

const WALLETS = [
  ["proxy", PM_PROXY_ADDRESS],
  ["signer", PM_ACCOUNT_ADDRESS],
  ["deposit", PM_DEPOSIT_ADDRESS],
  ["previous-proxy", PM_EXTRA_ADDRESSES],
];

function httpsRequest(url, options) {
  const method = (options && options.method) || "GET";
  const headers = (options && options.headers) || {};
  const body = options && options.body;
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: method, headers: headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getJson(url) {
  const res = await httpsRequest(url);
  let body;
  try {
    body = res.text ? JSON.parse(res.text) : null;
  } catch (err) {
    body = res.text;
  }
  if (res.status < 200 || res.status >= 300) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(res.status + " " + detail);
  }
  return body;
}

async function rpc(method, params) {
  const res = await httpsRequest(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }),
  });
  const json = JSON.parse(res.text);
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

function encodeBalanceOf(holder) {
  const addr = holder.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return "0x70a08231" + addr;
}

function formatUnits(raw, decimals) {
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? whole + "." + frac : whole.toString();
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value == null ? "" : value);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

async function onChainBalances(address) {
  const calls = TOKENS.map(async ([symbol, token]) => {
    const raw = await rpc("eth_call", [{ to: token, data: encodeBalanceOf(address) }, "latest"]);
    return [symbol, formatUnits(raw, 6)];
  });
  const polRaw = rpc("eth_getBalance", [address, "latest"]);
  const entries = await Promise.all(calls.concat([polRaw.then((raw) => ["POL", formatUnits(raw, 18)])]));
  return Object.fromEntries(entries);
}

async function portfolioValue(address) {
  const body = await getJson(DATA_API + "/value?user=" + address);
  if (body && body.data && body.data.value != null) return body.data.value;
  if (body && body.value != null) return body.value;
  return null;
}

async function positions(address) {
  const rows = [];
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const url = new URL(DATA_API + "/positions");
    url.searchParams.set("user", address);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const body = await getJson(url);
    const data = Array.isArray(body) ? body : (body && body.data) || [];
    rows.push.apply(rows, data);
    cursor = (body && body.pagination && body.pagination.next_cursor) || "";
    if (!cursor || (body && body.pagination && body.pagination.has_more === false)) break;
  }
  return rows;
}

function clobSignature(timestamp, method, requestPath) {
  const standard = PM_API_SECRET.replace(/-/g, "+").replace(/_/g, "/");
  const key = Buffer.from(standard, "base64");
  const sig = crypto.createHmac("sha256", key).update(String(timestamp) + method + requestPath).digest("base64");
  return sig.replace(/\+/g, "-").replace(/\//g, "_");
}

async function clobCollateral(signatureType, address) {
  const timestamp = Math.floor(Date.now() / 1000);
  const requestPath = "/balance-allowance";
  const url = new URL(CLOB + requestPath);
  url.searchParams.set("asset_type", "COLLATERAL");
  url.searchParams.set("signature_type", String(signatureType));
  const res = await httpsRequest(url, {
    headers: {
      POLY_ADDRESS: address,
      POLY_SIGNATURE: clobSignature(timestamp, "GET", requestPath),
      POLY_TIMESTAMP: String(timestamp),
      POLY_API_KEY: PM_API_KEY,
      POLY_PASSPHRASE: PM_API_PASSPHRASE,
    },
  });
  let body;
  try {
    body = JSON.parse(res.text);
  } catch {
    body = { error: res.text };
  }
  if (res.status < 200 || res.status >= 300) throw new Error(body.error || res.text || String(res.status));
  return body;
}

function printPositions(rows) {
  if (!rows.length) {
    console.log("  no open positions");
    return;
  }
  let marked = 0;
  for (const row of rows) {
    const title = row.title || row.slug || row.condition_id || "position";
    const outcome = row.outcome || "";
    const size = row.current_size != null ? row.current_size : row.size;
    const value = Number(row.current_value != null ? row.current_value : 0);
    const pnl = row.unrealized_pnl != null ? row.unrealized_pnl : row.cash_pnl;
    if (Number.isFinite(value)) marked += value;
    console.log(
      "  " + title + " [" + outcome + "]  size " + size +
      "  value $" + money(value) + "  unrealized $" + money(pnl) + "  " + (row.status || "")
    );
  }
  console.log("  marked position sum $" + money(marked));
}

async function main() {
  for (const pair of WALLETS) {
    const label = pair[0];
    const address = pair[1];
    console.log("\n" + label + "  " + address);
    try {
      const cash = await onChainBalances(address);
      const value = await portfolioValue(address);
      const rows = await positions(address);
      console.log(
        "  wallet cash   pUSD " + cash.pUSD +
        "   USDC.e " + cash["USDC.e"] +
        "   USDC " + cash.USDC +
        "   POL " + cash.POL
      );
      console.log("  data-api mark $" + money(value));
      printPositions(rows);
    } catch (err) {
      console.log("  failed: " + err.message);
    }
  }

  console.log("\nCLOB collateral for " + PM_ACCOUNT_ADDRESS);
  for (const pair of SIGNATURE_TYPES) {
    const id = pair[0];
    const name = pair[1];
    try {
      const body = await clobCollateral(id, PM_ACCOUNT_ADDRESS);
      console.log("  " + id + " " + name + "  balance " + formatUnits(body.balance || "0", 6) + " pUSD");
    } catch (err) {
      console.log("  " + id + " " + name + "  " + err.message);
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
