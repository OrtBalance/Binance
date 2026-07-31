const https = require('https');
const crypto = require('crypto');

// --- Configure your Azbit API credentials here ---
// Or set AZBIT_API_KEY / AZBIT_API_SECRET environment variables.
const API_KEY = (process.env.AZBIT_API_KEY || 'snQOVapj46dw4c7AjhJGRA4dAkWyuKkFXM41Ig').trim();
const API_SECRET = (process.env.AZBIT_API_SECRET || 'sPuwXjceF6TQTZqQFyzJ6mLkuwtslvHOvMTiqHaauSPFj0xYa2dRBt1Ne06j3gvW0h7fYg').trim();

// Check interval in ms (60000 = 1 minute). Set to 0 for a single check.
const CHECK_INTERVAL_MS = 0;

const API_HOST = 'data.azbit.com';
const API_BASE = 'https://data.azbit.com/api';
const ENDPOINT = 'wallets/balances';
const REQUEST_URL = `${API_BASE}/${ENDPOINT}`;

function signRequest(params = {}) {
  // Azbit signed GET requests use JSON.stringify(params); empty params -> "[]"
  const requestBodyString = JSON.stringify(params);
  const signatureText = API_KEY + REQUEST_URL + requestBodyString;
  return crypto.createHmac('sha256', API_SECRET).update(signatureText).digest('hex');
}

function apiRequest(path, params = {}) {
  return new Promise((resolve, reject) => {
    const signature = signRequest(params);

    const req = https.request(
      {
        hostname: API_HOST,
        path,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'API-PublicKey': API_KEY,
          'API-Signature': signature,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const trimmed = data.trim();
          if (!trimmed) {
            reject(new Error(`Empty response from Azbit (HTTP ${res.statusCode})`));
            return;
          }

          let json;
          try {
            json = JSON.parse(trimmed);
          } catch {
            reject(new Error(trimmed));
            return;
          }

          if (res.statusCode !== 200) {
            const message =
              json.message || json.error || json.title || JSON.stringify(json);
            reject(new Error(`${message} (HTTP ${res.statusCode})`));
          } else {
            resolve(json);
          }
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

function getBalances() {
  // Match the reference Azbit client request path (trailing "?" with no query params).
  return apiRequest(`/api/${ENDPOINT}?`, {});
}

function formatBalance(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return num.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function mergeBalances(data) {
  const byCurrency = new Map();

  for (const item of data.balances || []) {
    byCurrency.set(item.currencyCode, {
      currency: item.currencyCode,
      available: Number(item.amount) || 0,
      locked: 0,
    });
  }

  for (const item of data.balancesBlockedInOrder || []) {
    const existing = byCurrency.get(item.currencyCode) || {
      currency: item.currencyCode,
      available: 0,
      locked: 0,
    };
    existing.locked = Number(item.amount) || 0;
    byCurrency.set(item.currencyCode, existing);
  }

  return Array.from(byCurrency.values());
}

function printBalances(data) {
  const timestamp = new Date().toLocaleString();
  const merged = mergeBalances(data);
  const nonZero = merged.filter((b) => b.available > 0 || b.locked > 0);

  console.log('\n' + '='.repeat(60));
  console.log(`Azbit Balance Check — ${timestamp}`);
  console.log('='.repeat(60));

  if (nonZero.length === 0) {
    console.log('No assets with balance found.');
  } else {
    console.log(
      `${'Currency'.padEnd(12)} ${'Available'.padStart(18)} ${'Locked'.padStart(18)} ${'Total'.padStart(18)}`
    );
    console.log('-'.repeat(60));

    for (const { currency, available, locked } of nonZero) {
      const total = available + locked;
      console.log(
        `${currency.padEnd(12)} ${formatBalance(available).padStart(18)} ${formatBalance(locked).padStart(18)} ${formatBalance(total).padStart(18)}`
      );
    }

    console.log('-'.repeat(60));
    console.log(`Assets with balance: ${nonZero.length}`);
  }

  if (data.totalUsdt != null || data.totalBtc != null) {
    console.log('-'.repeat(60));
    if (data.totalUsdt != null) {
      console.log(`Portfolio total (USDT): ${formatBalance(data.totalUsdt)}`);
    }
    if (data.totalBtc != null) {
      console.log(`Portfolio total (BTC):  ${formatBalance(data.totalBtc)}`);
    }
    if (data.totalInOrderUsdt != null && Number(data.totalInOrderUsdt) > 0) {
      console.log(`In orders (USDT):       ${formatBalance(data.totalInOrderUsdt)}`);
    }
  }
}

function getPublicIp() {
  return new Promise((resolve) => {
    https
      .get('https://api.ipify.org?format=json', (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data).ip);
          } catch {
            resolve('unknown');
          }
        });
      })
      .on('error', () => resolve('unknown'));
  });
}

async function printInvalidKeyHelp() {
  const ip = await getPublicIp();
  console.error('\nFix checklist:');
  console.error(`  1. API host: ${API_HOST}`);
  console.error(`  2. Public key loaded: ${API_KEY.slice(0, 4)}...${API_KEY.slice(-4)} (${API_KEY.length} chars)`);
  console.error('  3. Permissions: enable read-only access on the API key');
  console.error(`  4. IP whitelist: if restricted, add this IP -> ${ip}`);
  console.error('  5. Key source: create keys at azbit.com -> Settings -> API Keys');
  console.error('  6. Secret: re-copy the secret (shown only once when the key was created)');
  console.error('  7. If the key was exposed (e.g. on GitHub), delete it and create a new one');
}

async function checkBalance() {
  try {
    const data = await getBalances();
    printBalances(data);
  } catch (error) {
    console.error('\nBalance check failed:', error.message);

    const msg = error.message.toLowerCase();
    if (msg.includes('unknown api-publickey')) {
      console.error('Azbit does not recognize this API public key.');
      console.error('Create a new API key on Azbit and paste the full public key + secret.');
      await printInvalidKeyHelp();
    } else if (msg.includes('signature')) {
      console.error('The API secret is wrong, or the signature format does not match.');
      console.error('Re-copy the secret from Azbit API Management.');
      await printInvalidKeyHelp();
    } else if (msg.includes('unauthorized') || msg.includes('401')) {
      console.error('Authentication failed. Re-check your API key and secret.');
      await printInvalidKeyHelp();
    } else if (msg.includes('ip')) {
      const ip = await getPublicIp();
      console.error(`Your IP (${ip}) may not be whitelisted on this API key.`);
    }
  }
}

function main() {
  if (
    !API_KEY ||
    !API_SECRET ||
    API_KEY.includes('your_api_key') ||
    API_SECRET.includes('your_api_secret')
  ) {
    console.error('Set AZBIT_API_KEY and AZBIT_API_SECRET, or edit the constants at the top of this file.');
    process.exit(1);
  }

  console.log('Azbit Balance Bot started.');
  console.log(`Mode: ${CHECK_INTERVAL_MS <= 0 ? 'single check' : `every ${CHECK_INTERVAL_MS / 1000}s`}`);

  checkBalance();

  if (CHECK_INTERVAL_MS > 0) {
    setInterval(checkBalance, CHECK_INTERVAL_MS);
  }
}

main();
